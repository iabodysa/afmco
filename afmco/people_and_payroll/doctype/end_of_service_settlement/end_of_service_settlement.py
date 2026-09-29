from __future__ import annotations

from collections.abc import Callable, Iterable

import frappe
from frappe.model.document import Document


class EndofServiceSettlement(Document):
    def on_update(self):
        if not self.has_value_changed("workflow_state"):
            return
        if self.workflow_state == PENDING_STATE and self.employee_status != DONE_MARKER:
            today = frappe.utils.getdate(frappe.utils.nowdate())
            if is_due(frappe.utils.getdate(self.date_2) if self.date_2 else None, today):
                relieve_employee(self)
        elif self.workflow_state == CANCELLED_STATE:
            restore_employee(self)

    def on_cancel(self):
        restore_employee(self)


EOS_DOCTYPE = "End of Service Settlement"
EMPLOYEE_DOCTYPE = "Employee"
PENDING_STATE = "Approved"
DONE_MARKER = "Updated"
NOT_DONE_MARKER = "Not updated"
CANCELLED_STATE = "Cancelled"
LEFT_STATUS = "Left"
RELIEVING_SAVEPOINT = "afmco_employee_relieving"

FEEDBACK_LINES = (
    ("Employee Name", "employee_name"),
    ("Employee ID", "employee"),
    ("Total Salary", "total_salary"),
    ("Daily Salary", "salary_per_day"),
    ("Ticket Allowance", "ticket_allowance"),
    ("EOS", "total_eos"),
    ("Deductions", "deductions"),
    ("Total Vacation Allowance", "cva_total"),
    ("Total Amount", "amount"),
    ("Service Duration", "duration_of_service"),
    ("End of Service Reason", "end_of_service_reason"),
    ("Alternative Reward", "alternative_reward"),
)


def _value(record, field: str):
    return record.get(field) if isinstance(record, dict) else getattr(record, field, None)


def pending_filters() -> dict[str, object]:
    return {"workflow_state": PENDING_STATE, "employee_status": ["!=", DONE_MARKER]}


def is_due(end_date, today) -> bool:
    if not end_date:
        return False
    return today > end_date


def feedback_for(record) -> str:
    lines = ["End of Service Benefits:"]
    for label, field in FEEDBACK_LINES:
        value = _value(record, field)
        lines.append(f"- {label}: {value}")
    return "\n".join(lines)


def employee_values(record) -> dict[str, object]:
    return {
        "status": LEFT_STATUS,
        "relieving_date": _value(record, "date_2"),
        "feedback": feedback_for(record),
        "reason_for_leaving": f"{_value(record, 'name')} | {_value(record, 'end_of_service_reason')}",
        "resignation_letter_date": _value(record, "creation"),
    }


def relieve_employee(document) -> None:
    employee = frappe.get_doc(EMPLOYEE_DOCTYPE, document.employee)
    prior_status = employee.status
    employee.update(employee_values(document))
    employee.save(ignore_permissions=True)
    document.db_set({"employee_status": DONE_MARKER, "employee_prior_status": prior_status})


def restore_employee(document) -> None:
    if document.employee_status != DONE_MARKER or document.employee_prior_status in (None, "", LEFT_STATUS):
        return
    employee = frappe.get_doc(EMPLOYEE_DOCTYPE, document.employee)
    if employee.status != LEFT_STATUS or not (employee.reason_for_leaving or "").startswith(f"{document.name} | "):
        return
    employee.update({"status": document.employee_prior_status, "relieving_date": None, "reason_for_leaving": None})
    employee.save(ignore_permissions=True)
    document.db_set({"employee_status": NOT_DONE_MARKER, "employee_prior_status": None})


def process(records: Iterable[dict], apply: Callable[[dict], None]) -> dict[str, object]:
    updated = 0
    errors: list[str] = []
    for record in records:
        try:
            apply(record)
        except Exception as error:
            errors.append(f"{_value(record, 'name')}: {error}")
        else:
            updated += 1
    return {"updated": updated, "errors": errors}


def update_employee_status_for_settlements() -> dict[str, object]:
    import frappe

    today = frappe.utils.getdate(frappe.utils.nowdate())
    names = frappe.get_all(EOS_DOCTYPE, filters=pending_filters(), pluck="name")

    def apply(record: dict) -> None:
        document = frappe.get_doc(EOS_DOCTYPE, record["name"])
        if not is_due(frappe.utils.getdate(document.date_2) if document.date_2 else None, today):
            return
        frappe.db.savepoint(RELIEVING_SAVEPOINT)
        try:
            relieve_employee(document)
        except Exception:
            frappe.db.rollback(save_point=RELIEVING_SAVEPOINT)
            raise

    outcome = process(({"name": name} for name in names), apply)
    if outcome["errors"]:
        frappe.log_error(
            title="End of service status task",
            message="\n".join(str(error) for error in outcome["errors"]),
        )
    return outcome


def mark_paid_settlements():
    eos_docs = frappe.get_all(
        "End of Service Settlement",
        filters={"workflow_state": ["!=", "Paid"]},
        fields=["name", "workflow_state", "pr_status"]
    )

    for eos in eos_docs:
        try:
            pr = frappe.db.get_value(
                "Payment Requisition",
                {"tax_invoice_number": eos.name},
                ["name", "workflow_state"]
            )

            if pr:
                frappe.db.set_value("End of Service Settlement", eos.name, "pr_status", "PR Created")

                if pr[1] == "Paid":
                    frappe.db.set_value("End of Service Settlement", eos.name, {
                        "workflow_state": "Paid",
                        "docstatus": 1
                    })

                    frappe.get_doc({
                        "doctype": "Comment",
                        "comment_type": "Info",
                        "reference_doctype": "End of Service Settlement",
                        "reference_name": eos.name,
                        "content": "Payment Request marked as Paid. EOS record has been automatically updated accordingly."
                    }).insert(ignore_permissions=True)
        except Exception as e:
            frappe.log_error(f"Error processing EOS {eos.name}: {str(e)}", "EOS Payment Sync Error")

    frappe.db.commit()

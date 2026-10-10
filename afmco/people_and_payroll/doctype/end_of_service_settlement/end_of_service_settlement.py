from __future__ import annotations

from collections.abc import Callable, Iterable

import frappe
from frappe import _
from frappe.model.document import Document

from afmco.approver_check import ai_reading
from afmco.people_and_payroll.advance_leave_salary import recompute_settlement, refuse_unpaid_settled_period, service_span


class EndofServiceSettlement(Document):
    def onload(self):
        ai_reading.set_onload(self)

    def validate(self):
        if self.employee and frappe.get_all(
            self.doctype,
            filters={
                "employee": self.employee,
                "docstatus": ["<", 2],
                "workflow_state": ["!=", CANCELLED_STATE],
                "name": ["!=", self.name],
            },
            limit=1,
        ):
            frappe.throw(
                _("{0} must be unique").format(_(self.meta.get_label("employee"))), frappe.UniqueValidationError
            )
        recompute_settlement(self)

    def before_submit(self):
        refuse_unpaid_settled_period(self)

    def on_update(self):
        if self.has_value_changed("workflow_state") and self.workflow_state == CANCELLED_STATE:
            restore_employee(self)

    def on_submit(self):
        if self.employee_status != DONE_MARKER:
            relieve_employee(self)

    def on_cancel(self):
        restore_employee(self)


EOS_DOCTYPE = "End of Service Settlement"
EMPLOYEE_DOCTYPE = "Employee"
DONE_MARKER = "Updated"
NOT_DONE_MARKER = "Not updated"
CANCELLED_STATE = "Cancelled"
LEFT_STATUS = "Left"
RELIEVING_SAVEPOINT = "afmco_employee_relieving"
RELIEVING_FIELDS = ("relieving_date", "feedback", "reason_for_leaving", "resignation_letter_date")

FEEDBACK_LINES = (
    ("Employee Name", "employee_name"),
    ("Employee ID", "employee"),
    ("Total Salary", "total_salary"),
    ("Daily Salary", "salary_per_day"),
    ("Ticket Allowance", "ticket_allowance"),
    ("EOS", "total_eos"),
    ("Deductions", "deductions"),
    ("Total Advance Leave Salary", "cva_total"),
    ("Total Amount", "amount"),
    ("Service Duration", "duration_of_service"),
    ("End of Service Reason", "end_of_service_reason"),
    ("Alternative Reward", "alternative_reward"),
)


def _value(record, field: str):
    return record.get(field) if isinstance(record, dict) else getattr(record, field, None)


def pending_filters() -> dict[str, object]:
    return {"docstatus": 1, "employee_status": ["!=", DONE_MARKER]}


def relieving_date_for(record):
    last_working_day = _value(record, "date_2")
    if not last_working_day:
        return None
    return frappe.utils.getdate(last_working_day)


def is_due(relieving_date, today) -> bool:
    if not relieving_date:
        return False
    return today > relieving_date


def service_duration(record) -> str:
    start, end = _value(record, "date_1"), _value(record, "date_2")
    if not (start and end):
        return ""
    years, months, days = service_span(start, end)
    return f"{years} Year(s), {months} Month(s), {days} Day(s)"


def feedback_for(record) -> str:
    lines = ["End of Service Benefits:"]
    for label, field in FEEDBACK_LINES:
        value = service_duration(record) if field == "duration_of_service" else _value(record, field)
        lines.append(f"- {label}: {'' if value is None else value}")
    return "\n".join(lines)


def employee_values(record) -> dict[str, object]:
    return {
        "status": LEFT_STATUS,
        "relieving_date": relieving_date_for(record),
        "feedback": feedback_for(record),
        "reason_for_leaving": f"{_value(record, 'name')} | {_value(record, 'end_of_service_reason')}",
        "resignation_letter_date": frappe.utils.getdate(_value(record, "creation")),
    }


def relieve_employee(document) -> None:
    employee = frappe.get_doc(EMPLOYEE_DOCTYPE, document.employee)
    prior_status = employee.status
    prior_values = {field: employee.get(field) for field in RELIEVING_FIELDS}
    employee.update(employee_values(document))
    employee.save(ignore_permissions=True)
    document.db_set(
        {
            "employee_status": DONE_MARKER,
            "employee_prior_status": prior_status,
            "employee_prior_values": frappe.as_json(prior_values),
        }
    )


def restore_employee(document) -> None:
    if document.employee_status != DONE_MARKER or document.employee_prior_status in (None, "", LEFT_STATUS):
        return
    employee = frappe.get_doc(EMPLOYEE_DOCTYPE, document.employee)
    if employee.status != LEFT_STATUS or not (employee.reason_for_leaving or "").startswith(f"{document.name} | "):
        return
    prior_values = frappe.parse_json(document.employee_prior_values or "{}")
    employee.update({"status": document.employee_prior_status, **{field: prior_values.get(field) for field in RELIEVING_FIELDS}})
    employee.save(ignore_permissions=True)
    document.db_set({"employee_status": NOT_DONE_MARKER, "employee_prior_status": None, "employee_prior_values": None})


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
        if not is_due(relieving_date_for(document), today):
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


def mark_settlement_paid(name):
    frappe.db.set_value("End of Service Settlement", name, {
        "pr_status": "PR Created",
        "workflow_state": "Paid",
        "docstatus": 1
    })

    frappe.get_doc({
        "doctype": "Comment",
        "comment_type": "Info",
        "reference_doctype": "End of Service Settlement",
        "reference_name": name,
        "content": "Payment Request marked as Paid. EOS record has been automatically updated accordingly."
    }).insert(ignore_permissions=True)


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

            if pr and pr[1] == "Paid":
                mark_settlement_paid(eos.name)
            elif pr:
                frappe.db.set_value("End of Service Settlement", eos.name, "pr_status", "PR Created")
        except Exception as e:
            frappe.log_error(f"Error processing EOS {eos.name}: {str(e)}", "EOS Payment Sync Error")

    frappe.db.commit()

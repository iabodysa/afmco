from __future__ import annotations

from collections.abc import Callable, Iterable

from afmco.people_and_payroll.employee import HOLD_STATUS


BANK_CODES = {
    "10": "NCBK",
    "80": "RJHI",
    "30": "RIBL",
    "05": "INMA",
    "15": "ALBI",
    "60": "BJAZ",
    "35": "ARNB",
    "55": "BSFR",
    "45": "SABB",
    "20": "SAMB",
    "65": "SIBC",
    "90": "GULF",
}
MINIMUM_ACCOUNT_LENGTH = 6
EMPLOYEE_DOCTYPE = "Employee"


def bank_name_for(account_number: str | None) -> str | None:
    if not account_number:
        return None
    text = str(account_number)
    if len(text) < MINIMUM_ACCOUNT_LENGTH:
        return None
    return BANK_CODES.get(text[:2])


def plan_updates(employees: Iterable[dict]) -> list[dict]:
    updates = []
    for employee in employees:
        derived = bank_name_for(employee.get("bank_ac_no"))
        if derived and derived != employee.get("bank_name"):
            updates.append({"name": employee.get("name"), "bank_name": derived})
    return updates


def process_bank_updates(updates: Iterable[dict], apply: Callable[[dict], None]) -> dict[str, object]:
    updated = 0
    errors: list[str] = []
    for update in updates:
        try:
            apply(update)
        except Exception as error:
            errors.append(f"{update.get('name')}: {error}")
        else:
            updated += 1
    return {"updated": updated, "errors": errors}


def update_employee_bank_names() -> dict[str, object]:
    import frappe

    employees = frappe.get_all(EMPLOYEE_DOCTYPE, fields=["name", "bank_ac_no", "bank_name"])

    def apply(update: dict) -> None:
        frappe.db.set_value(EMPLOYEE_DOCTYPE, update["name"], "bank_name", update["bank_name"])
        document = frappe.get_doc(EMPLOYEE_DOCTYPE, update["name"])
        document.add_comment("Comment", f"Bank name updated to {update['bank_name']}")

    outcome = process_bank_updates(plan_updates(employees), apply)
    if outcome["errors"]:
        frappe.log_error(
            title="Employee bank name task",
            message="\n".join(str(error) for error in outcome["errors"]),
        )
    return outcome


SALARY_SLIP_DOCTYPE = "Salary Slip"
WINDOW_MONTHS = -3
EXCLUDED_DEPARTMENTS = ["Remotely - عن بعد - AF"]
REASON = "no salary slip in the last 3 months"
DEACTIVATION_SAVEPOINT = "afmco_employee_deactivation"
NOTIFIED_ROLE = "HR Manager"
HOLD_EMAIL_TEMPLATE = "employees_on_hold_without_salary"


def candidate_filters(window_start: str) -> dict[str, object]:
    return {
        "status": "Active",
        "date_of_joining": ["<=", window_start],
        "department": ["not in", EXCLUDED_DEPARTMENTS],
    }


def slip_filters(employee: str, window_start: str) -> dict[str, object]:
    return {"employee": employee, "start_date": [">=", window_start]}


def should_deactivate(salary_slips: list) -> bool:
    return not salary_slips


def employee_values() -> dict[str, str]:
    return {
        "status": HOLD_STATUS,
        "feedback": f"Employee status updated to '{HOLD_STATUS}' due to {REASON}.",
    }


def comment_for(today: str) -> str:
    return f"Status updated to {HOLD_STATUS} on {today} due to {REASON}."


def process_deactivations(names: Iterable[str], apply: Callable[[str], bool]) -> dict[str, object]:
    moved: list[str] = []
    failed: list[dict[str, str]] = []
    for name in names:
        try:
            if apply(name):
                moved.append(name)
        except Exception as error:
            failed.append({"employee": name, "reason": str(error) or type(error).__name__})
    return {"updated": len(moved), "moved": moved, "failed": failed}


def last_salary_month(employee: str) -> str | None:
    import frappe

    starts = frappe.get_all(
        SALARY_SLIP_DOCTYPE,
        filters={"employee": employee, "docstatus": 1},
        pluck="start_date",
        order_by="start_date desc",
        limit=1,
    )
    return frappe.utils.getdate(starts[0]).strftime("%Y-%m") if starts else None


def moved_rows(names: list[str]) -> list[dict]:
    import frappe

    rows = frappe.get_all(
        EMPLOYEE_DOCTYPE,
        filters={"name": ["in", names]},
        fields=["name", "employee_name", "department", "designation"],
        order_by="name asc",
    )
    for row in rows:
        row["last_salary_month"] = last_salary_month(row["name"])
    return rows


def short_reason(reason: str) -> str:
    lines = [line.strip() for line in reason.splitlines() if line.strip()]
    return lines[0] if lines else reason


def failed_rows(failed: list[dict[str, str]]) -> list[dict]:
    import frappe
    from frappe.utils import strip_html_tags

    names = dict(
        frappe.get_all(
            EMPLOYEE_DOCTYPE,
            filters={"name": ["in", [row["employee"] for row in failed]]},
            fields=["name", "employee_name"],
            as_list=True,
        )
    )
    return [
        {
            "name": row["employee"],
            "employee_name": names.get(row["employee"]) or row["employee"],
            "reason": short_reason(strip_html_tags(row["reason"])),
        }
        for row in failed
    ]


def notify_hr_managers(moved: list[str], failed: list[dict[str, str]]) -> None:
    import frappe
    from frappe.utils.jinja_globals import is_rtl
    from frappe.utils.user import get_users_with_role

    if not moved and not failed:
        return
    recipients = get_users_with_role(NOTIFIED_ROLE)
    if not recipients:
        return
    frappe.sendmail(
        recipients=recipients,
        subject=frappe._("Employees on Hold for no salary slip in the last 3 months"),
        template=HOLD_EMAIL_TEMPLATE,
        args={
            "employees": moved_rows(moved) if moved else [],
            "failed": failed_rows(failed) if failed else [],
            "direction": "rtl" if is_rtl() else "ltr",
            "site_url": frappe.utils.get_url(),
        },
    )


def deactivate_employees_without_salary_slip() -> dict[str, object]:
    import frappe

    today = frappe.utils.nowdate()
    window_start = frappe.utils.add_months(today, WINDOW_MONTHS)
    candidates = frappe.get_all(EMPLOYEE_DOCTYPE, filters=candidate_filters(window_start), pluck="name")

    def apply(name: str) -> bool:
        slips = frappe.get_all(SALARY_SLIP_DOCTYPE, filters=slip_filters(name, window_start), pluck="name")
        if not should_deactivate(slips):
            return False
        frappe.db.savepoint(DEACTIVATION_SAVEPOINT)
        try:
            employee = frappe.get_doc(EMPLOYEE_DOCTYPE, name)
            employee.update(employee_values())
            employee.save()
            employee.add_comment("Comment", comment_for(today))
        except Exception:
            frappe.db.rollback(save_point=DEACTIVATION_SAVEPOINT)
            raise
        return True

    outcome = process_deactivations(candidates, apply)
    notify_hr_managers(outcome["moved"], outcome["failed"])
    return outcome

from __future__ import annotations

from collections.abc import Callable, Iterable

from afmco.people_and_payroll.employee import HOLD_STATUS


EMPLOYEE_DOCTYPE = "Employee"
SALARY_SLIP_DOCTYPE = "Salary Slip"
PAYROLL_SETTINGS = "Payroll Settings"
HOLD_MONTHS_FIELD = "hold_after_months"
EXCLUDED_DEPARTMENTS = ["Remotely - عن بعد - AF"]
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
    return {"employee": employee, "start_date": [">=", window_start], "docstatus": 1}


def should_deactivate(salary_slips: list) -> bool:
    return not salary_slips


def hold_after_months() -> int:
    import frappe
    from frappe.utils import cint

    return cint(frappe.db.get_single_value(PAYROLL_SETTINGS, HOLD_MONTHS_FIELD)) or cint(
        frappe.get_meta(PAYROLL_SETTINGS).get_field(HOLD_MONTHS_FIELD).default
    )


def reason_for(months: int) -> str:
    return f"no salary slip in the last {months} months"


def employee_values(months: int) -> dict[str, str]:
    return {
        "status": HOLD_STATUS,
        "feedback": f"Employee status updated to '{HOLD_STATUS}' due to {reason_for(months)}.",
    }


def comment_for(today: str, months: int) -> str:
    return f"Status updated to {HOLD_STATUS} on {today} due to {reason_for(months)}."


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


def notify_hr_managers(moved: list[str], failed: list[dict[str, str]], months: int) -> None:
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
        subject=frappe._("Employees on Hold for no salary slip in the last {0} months").format(months),
        template=HOLD_EMAIL_TEMPLATE,
        args={
            "employees": moved_rows(moved) if moved else [],
            "failed": failed_rows(failed) if failed else [],
            "months": months,
            "direction": "rtl" if is_rtl() else "ltr",
            "site_url": frappe.utils.get_url(),
        },
    )


def deactivate_employees_without_salary_slip() -> dict[str, object]:
    import frappe

    today = frappe.utils.nowdate()
    months = hold_after_months()
    window_start = frappe.utils.add_months(today, -months)
    candidates = frappe.get_all(EMPLOYEE_DOCTYPE, filters=candidate_filters(window_start), pluck="name")

    def hold(name: str) -> None:
        employee = frappe.get_doc(EMPLOYEE_DOCTYPE, name)
        employee.update(employee_values(months))
        employee.flags.ignore_mandatory = True
        employee.save()
        employee.add_comment("Comment", comment_for(today, months))

    def apply(name: str) -> bool:
        slips = frappe.get_all(SALARY_SLIP_DOCTYPE, filters=slip_filters(name, window_start), pluck="name")
        if not should_deactivate(slips):
            return False
        frappe.db.savepoint(DEACTIVATION_SAVEPOINT)
        try:
            try:
                hold(name)
            except frappe.TimestampMismatchError:
                frappe.db.rollback(save_point=DEACTIVATION_SAVEPOINT)
                hold(name)
        except Exception:
            frappe.db.rollback(save_point=DEACTIVATION_SAVEPOINT)
            raise
        return True

    outcome = process_deactivations(candidates, apply)
    notify_hr_managers(outcome["moved"], outcome["failed"], months)
    return outcome

from __future__ import annotations

from collections.abc import Callable, Iterable


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
INACTIVE_STATUS = "Inactive"
REASON = "no salary slip in the last 3 months"
DEACTIVATION_SAVEPOINT = "afmco_employee_deactivation"


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
        "status": INACTIVE_STATUS,
        "feedback": f"Employee status updated to '{INACTIVE_STATUS}' due to {REASON}.",
    }


def comment_for(today: str) -> str:
    return f"Status updated to {INACTIVE_STATUS} on {today} due to {REASON}."


def process_deactivations(names: Iterable[str], apply: Callable[[str], None]) -> dict[str, object]:
    updated = 0
    errors: list[str] = []
    for name in names:
        try:
            apply(name)
        except Exception as error:
            errors.append(f"{name}: {error}")
        else:
            updated += 1
    return {"updated": updated, "errors": errors}


def deactivate_employees_without_salary_slip() -> dict[str, object]:
    import frappe

    today = frappe.utils.nowdate()
    window_start = frappe.utils.add_months(today, WINDOW_MONTHS)
    candidates = frappe.get_all(EMPLOYEE_DOCTYPE, filters=candidate_filters(window_start), pluck="name")

    def apply(name: str) -> None:
        slips = frappe.get_all(SALARY_SLIP_DOCTYPE, filters=slip_filters(name, window_start), pluck="name")
        if not should_deactivate(slips):
            return
        frappe.db.savepoint(DEACTIVATION_SAVEPOINT)
        try:
            employee = frappe.get_doc(EMPLOYEE_DOCTYPE, name)
            employee.update(employee_values())
            employee.save()
            employee.add_comment("Comment", comment_for(today))
        except Exception:
            frappe.db.rollback(save_point=DEACTIVATION_SAVEPOINT)
            raise

    outcome = process_deactivations(candidates, apply)
    if outcome["errors"]:
        frappe.log_error(
            title="Inactive without salary slip task",
            message="\n".join(str(error) for error in outcome["errors"]),
        )
    return outcome

# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from __future__ import annotations

import datetime
from collections.abc import Callable, Iterable

import frappe
from frappe.model.document import Document


class IqamaRenewalTracking(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.reject_inactive_employee()

	def reject_inactive_employee(self):
		if self.employee_status != "Active":
			self.status = "Rejected"


EMPLOYEE_DOCTYPE = "Employee"
TRACKING_DOCTYPE = "Iqama Renewal Tracking"
DEDUPE_WINDOW_DAYS = -60
REFRESH_WINDOW_DAYS = -30
NEW_STATUS = "New"
RENEWED_STATUS = "Renewed"


def _value(record, field: str):
    return record.get(field) if isinstance(record, dict) else getattr(record, field, None)


def month_window(today: datetime.date) -> tuple[datetime.date, datetime.date]:
    first_of_this_month = today.replace(day=1)
    year = first_of_this_month.year + (first_of_this_month.month == 12)
    month = 1 if first_of_this_month.month == 12 else first_of_this_month.month + 1
    start = datetime.date(year, month, 1)

    year_after = start.year + (start.month == 12)
    month_after = 1 if start.month == 12 else start.month + 1
    end = datetime.date(year_after, month_after, 1) - datetime.timedelta(days=1)
    return start, end


def employee_filters(start, end) -> list[list]:
    return [
        ["status", "=", "Active"],
        ["iqama_expiration_date", "<=", end],
        ["iqama_expiration_date", ">=", start],
        ["corporation", "is", "set"],
        ["iqama_expiration_date", "is", "set"],
    ]


def refresh_filters(since) -> list[list]:
    return [["creation", ">", since], ["status", "!=", RENEWED_STATUS]]


def needs_new_tracking(recent_tracking: list) -> bool:
    return not recent_tracking


def tracking_values(employee, today) -> dict[str, object]:
    return {
        "doctype": TRACKING_DOCTYPE,
        "employee": _value(employee, "name"),
        "employee_name": _value(employee, "employee_name"),
        "department": _value(employee, "department"),
        "corporation": _value(employee, "corporation"),
        "iqama_expiration_date": _value(employee, "iqama_expiration_date"),
        "status": NEW_STATUS,
        "cost_center": _value(employee, "payroll_cost_center"),
        "posting_date": today,
    }


def needs_renewal_update(tracking, employee_expiry) -> bool:
    recorded = _value(tracking, "iqama_expiration_date")
    already_new = _value(tracking, "iqama_new_expiration_date")
    if recorded == employee_expiry:
        return False
    return not already_new or already_new != employee_expiry


def renewal_update(new_expiry) -> dict[str, object]:
    return {"iqama_new_expiration_date": new_expiry, "status": RENEWED_STATUS}


def process(items: Iterable, apply: Callable[[object], None]) -> dict[str, object]:
    updated = 0
    errors: list[str] = []
    for item in items:
        try:
            apply(item)
        except Exception as error:
            errors.append(f"{item}: {error}")
        else:
            updated += 1
    return {"updated": updated, "errors": errors}


def check_iqama_renewal() -> dict[str, object]:
    import frappe

    today = frappe.utils.getdate(frappe.utils.nowdate())
    start, end = month_window(today)
    dedupe_since = frappe.utils.add_days(today, DEDUPE_WINDOW_DAYS)
    refresh_since = frappe.utils.add_days(today, REFRESH_WINDOW_DAYS)

    employees = frappe.get_all(
        EMPLOYEE_DOCTYPE,
        filters=employee_filters(start, end),
        fields=[
            "name",
            "employee_name",
            "department",
            "corporation",
            "iqama_expiration_date",
            "payroll_cost_center",
        ],
    )

    def open_tracking(employee) -> None:
        existing = frappe.get_all(
            TRACKING_DOCTYPE,
            filters={"employee": employee["name"], "creation": [">", dedupe_since]},
            pluck="name",
            limit=1,
        )
        if needs_new_tracking(existing):
            frappe.get_doc(tracking_values(employee, today)).insert()

    opened = process(employees, open_tracking)

    recent = frappe.get_all(
        TRACKING_DOCTYPE,
        filters=refresh_filters(refresh_since),
        fields=["name", "employee", "iqama_expiration_date", "iqama_new_expiration_date"],
    )

    def close_tracking(tracking) -> None:
        employee_expiry = frappe.db.get_value(EMPLOYEE_DOCTYPE, tracking["employee"], "iqama_expiration_date")
        if not needs_renewal_update(tracking, employee_expiry):
            return
        document = frappe.get_doc(TRACKING_DOCTYPE, tracking["name"])
        for field, value in renewal_update(employee_expiry).items():
            setattr(document, field, value)
        document.save()

    closed = process(recent, close_tracking)

    errors = list(opened["errors"]) + list(closed["errors"])
    if errors:
        frappe.log_error(title="iQama renewal v1 task", message="\n".join(str(error) for error in errors))
    return {"opened": opened["updated"], "revisited": closed["updated"], "errors": errors}


DUE_STATUS = "Rescheduled"
NEXT_STATUS = "Awaiting Operations Approval"


def due_filters(today: str) -> dict[str, str]:
    return {"status": DUE_STATUS, "reschedule_date": today}


def transition() -> dict[str, object]:
    return {"status": NEXT_STATUS, "reschedule_date": None}


def reschedule_due_trackings() -> dict[str, object]:
    import frappe

    today = frappe.utils.nowdate()
    names = frappe.get_all(TRACKING_DOCTYPE, filters=due_filters(today), pluck="name")

    def apply(name: str) -> None:
        document = frappe.get_doc(TRACKING_DOCTYPE, name)
        for field, value in transition().items():
            setattr(document, field, value)
        document.save(ignore_permissions=True)

    outcome = process(names, apply)
    if outcome["errors"]:
        frappe.log_error(
            title="iQama reschedule task",
            message="\n".join(str(error) for error in outcome["errors"]),
        )
    return outcome

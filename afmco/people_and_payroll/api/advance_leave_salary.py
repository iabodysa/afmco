# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, getdate, now_datetime

from afmco.people_and_payroll.advance_leave_salary import (
    ADVANCE_LEAVE_SALARY,
    BALANCE,
    END_OF_SERVICE,
    EXTEND,
    NO_EXTENSION,
    RECOMPUTE,
    TAKEN,
    balance_ledger,
    fill_periods,
)
from afmco.people_and_payroll.service_calendar import service_value, unpaid_leave


def leave_document(doctype, name, permission):
    if doctype not in RECOMPUTE:
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    doc = frappe.get_doc(doctype, name)
    doc.check_permission(permission)
    return doc


def remembered_choice(doc):
    for doctype in (ADVANCE_LEAVE_SALARY, END_OF_SERVICE):
        for row in frappe.get_all(
            doctype,
            filters={
                "employee": doc.employee,
                "docstatus": 1,
                "name": ["!=", doc.name],
                "before_2024_leave": ["in", [TAKEN, BALANCE]],
            },
            fields=["name", "before_2024_leave"],
            order_by="creation desc",
            limit=1,
        ):
            return row
    return None


def chosen(doc, before_2024):
    if before_2024 in (TAKEN, BALANCE):
        return before_2024, None
    if doc.before_2024_leave:
        return doc.before_2024_leave, None
    row = remembered_choice(doc)
    return (row.before_2024_leave, row.name) if row else (None, None)


@frappe.whitelist(methods=["GET"])
def leave_details(doctype: str, name: str, before_2024: str | None = None) -> dict:
    doc = leave_document(doctype, name, "read")
    if not (doc.date_1 and doc.date_2):
        frappe.throw(_("Fill the joining date and the last date before calculating."))
    choice, source = chosen(doc, before_2024)
    years, _unpaid, asked = balance_ledger(doc, choice)
    last_day = getdate(doc.date_2)
    rows = [
        {
            "k": year.k,
            "start": year.start,
            "end": year.end,
            "entitlement": year.entitlement,
            "taken": year.taken,
            "used": year.used,
            "leave": year.leave,
            "absent": year.absent,
            "unpaid": year.unpaid,
            "balance": year.balance,
        }
        for year in years
        if year.start <= last_day
    ]
    return {
        "years": rows,
        "extension": sum(row["unpaid"] for row in rows),
        "ask_before_2024": bool(asked) and not source,
        "before_2024": choice if asked else None,
        "remembered_from": source if asked else None,
        "decision": doc.leave_extension,
        "employee": doc.employee,
        "exit_reentry_visas": frappe.db.count(
            "Employee Visa", {"employee": doc.employee}
        ),
    }


@frappe.whitelist(methods=["POST"])
def fill_leave_allowance(
    doctype: str, name: str, extension: str, before_2024: str | None = None
) -> None:
    if extension not in (EXTEND, NO_EXTENSION):
        frappe.throw(_("Choose whether to extend the contract year."))
    doc = leave_document(doctype, name, "write")
    choice, _source = chosen(doc, before_2024)
    if balance_ledger(doc, choice)[2] and not choice:
        frappe.throw(_("Choose how the contract years before 2024 count."))
    doc.update(
        {
            "leave_extension": extension,
            "before_2024_leave": choice if balance_ledger(doc, choice)[2] else None,
            "leave_decision_by": frappe.session.user,
            "leave_decision_on": now_datetime(),
        }
    )
    fill_periods(doc)
    doc.save()


@frappe.whitelist(methods=["POST"])
def create_advance_leave_salary(employee: str, vacation_start_date: str, check1: int = 0) -> str:
    doc = frappe.get_doc(
        {
            "doctype": ADVANCE_LEAVE_SALARY,
            "employee": employee,
            "date_2": vacation_start_date,
            "check1": cint(check1),
        }
    ).insert()
    return doc.name


@frappe.whitelist(methods=["GET"])
def end_of_service_years(start: str, end: str, employee: str | None = None) -> float:
    if employee:
        frappe.has_permission("Employee", "read", employee, throw=True)
    return service_value(start, end, unpaid_leave(employee))

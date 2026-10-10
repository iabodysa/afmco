# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint

from afmco.people_and_payroll.advance_leave_salary import (
    ADVANCE_LEAVE_SALARY,
    RECOMPUTE,
    fill_periods,
    service_span,
    service_years,
)


@frappe.whitelist(methods=["POST"])
def fill_leave_allowance(doctype: str, name: str) -> None:
    if doctype not in RECOMPUTE:
        frappe.throw(_("Not permitted"), frappe.PermissionError)
    doc = frappe.get_doc(doctype, name)
    doc.check_permission("write")
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
def end_of_service_years(start: str, end: str) -> float:
    return service_years(*service_span(start, end))

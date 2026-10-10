# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.people_and_payroll.advance_leave_salary import (
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


@frappe.whitelist(methods=["GET"])
def end_of_service_years(start: str, end: str) -> float:
    return service_years(*service_span(start, end))

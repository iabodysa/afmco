# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from hrms.payroll.doctype.payroll_entry import payroll_entry

from afmco.people_and_payroll.employee import HOLD_STATUS
from afmco.people_and_payroll.payroll_entry import (
	build_accrual_entry,
	build_bank_entry,
	build_employee_wise_entry,
)

VERIFICATION_ERROR_TITLE = "Errors during verification in Payroll Entry"


@frappe.whitelist(methods=["POST"])
def log_verification_errors(payroll_entry, message):
	frappe.has_permission("Payroll Entry", "read", payroll_entry, throw=True)
	frappe.log_error(
		title=VERIFICATION_ERROR_TITLE,
		message=message,
		reference_doctype="Payroll Entry",
		reference_name=payroll_entry,
	)


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def employee_query(doctype, txt, searchfield, start, page_len, filters):
	filters = frappe._dict(filters)
	filters.employees = [
		*(filters.employees or []),
		*frappe.get_all("Employee", filters={"status": HOLD_STATUS}, pluck="name"),
	]
	return payroll_entry.employee_query(doctype, txt, searchfield, start, page_len, filters)


def readable_payroll_entry(name):
	payroll_entry = frappe.get_doc("Payroll Entry", name)
	payroll_entry.check_permission("read")
	return payroll_entry


@frappe.whitelist()
def make_accrual_entry(source_name):
	return build_accrual_entry(readable_payroll_entry(source_name))


@frappe.whitelist()
def make_bank_entry(source_name):
	return build_bank_entry(readable_payroll_entry(source_name), frappe.flags.args or {})


@frappe.whitelist(methods=["POST"])
def make_employee_wise_journal_entry(payroll_entry, salary_slips):
	journal_entry = build_employee_wise_entry(
		readable_payroll_entry(payroll_entry), frappe.parse_json(salary_slips)
	)
	if journal_entry:
		return frappe.get_doc(journal_entry).insert().name

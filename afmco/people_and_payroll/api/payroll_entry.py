# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

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

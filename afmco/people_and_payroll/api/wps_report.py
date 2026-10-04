# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

from afmco.people_and_payroll.wps_file import build_payroll_entry_file


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def payroll_entries_newest_first(doctype, txt, searchfield, start, page_len, filters):
	return frappe.get_list(
		"Payroll Entry",
		filters={"name": ("like", f"%{txt}%")},
		fields=["name"],
		order_by="creation desc",
		offset=start,
		limit=page_len,
		as_list=True,
	)


@frappe.whitelist(methods=["POST"])
def download(payroll_entry, bank_format, file_type):
	if not frappe.get_cached_doc("Report", "WPS").is_permitted():
		raise frappe.PermissionError
	frappe.has_permission("Salary Slip", "report", throw=True)
	frappe.response.filename, frappe.response.filecontent = build_payroll_entry_file(
		payroll_entry, bank_format, file_type
	)
	frappe.response.type = "download"

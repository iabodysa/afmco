# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe


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

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe


@frappe.whitelist()
@frappe.validate_and_sanitize_search_inputs
def active_approvers(doctype, txt, searchfield, start, page_len, filters):
	return frappe.get_list(
		"Payment Approver",
		filters={"active": 1},
		or_filters={field: ("like", f"%{txt}%") for field in ("name", "name1", "department")},
		fields=["name", "name1", "department"],
		order_by="name",
		offset=start,
		limit=page_len,
		as_list=True,
		ignore_user_permissions=True,
	)

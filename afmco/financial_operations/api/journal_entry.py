# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

PAYMENT_REQUISITION = "Payment Requisition"


@frappe.whitelist()
def get_attachments(name: str) -> list[dict]:
	doc = frappe.get_doc("Journal Entry", name)
	doc.check_permission("read")

	sources = [("Journal Entry", name)]
	requisition = doc.get("expense_request_cf")
	if requisition and frappe.has_permission(PAYMENT_REQUISITION, "read", requisition):
		sources.append((PAYMENT_REQUISITION, requisition))

	files = []
	for doctype, docname in sources:
		files += frappe.get_all(
			"File",
			filters={"attached_to_doctype": doctype, "attached_to_name": docname, "is_folder": 0},
			fields=["file_name", "file_url", "attached_to_doctype", "attached_to_name"],
			order_by="creation asc",
		)
	return files

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import cint

from afmco.financial_operations import requisition_journal_entry

PAYMENT_REQUISITION = "Payment Requisition"


@frappe.whitelist()
def make_requisition_entry(name: str, bank_account: str, administration: int = 0) -> dict:
	requisition = frappe.get_doc(PAYMENT_REQUISITION, name)
	requisition.check_permission("read")
	return requisition_journal_entry.build(requisition, bank_account, bool(cint(administration))).as_dict()


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

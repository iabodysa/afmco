# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.financial_operations import requisition_pack
from afmco.financial_operations.requisition_pack import JOURNAL_ENTRY, PAYMENT_REQUISITION


@frappe.whitelist(methods=["POST"])
def attach_pack(requisition: str, journal_entry: str) -> dict:
	frappe.get_doc(PAYMENT_REQUISITION, requisition).check_permission("read")
	entry = frappe.get_doc(JOURNAL_ENTRY, journal_entry)
	entry.check_permission("write")
	if entry.get("expense_request_cf") != requisition:
		frappe.throw(
			_("Journal Entry {0} is not linked to Payment Requisition {1}.").format(
				journal_entry, requisition
			)
		)
	files = requisition_pack.requisition_files(requisition)
	if requisition_pack.input_size(files) > requisition_pack.BACKGROUND_THRESHOLD:
		frappe.enqueue(
			requisition_pack.attach,
			queue="long",
			job_id=f"requisition-pack::{journal_entry}",
			deduplicate=True,
			requisition=requisition,
			journal_entry=journal_entry,
		)
		return {"queued": True}
	return requisition_pack.attach(requisition, journal_entry)

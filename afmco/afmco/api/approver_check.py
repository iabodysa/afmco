# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.approver_check import ai_reading
from afmco.approver_check.registry import APPROVER_STATES


@frappe.whitelist(methods=["POST"])
def verify_attachments(doctype: str, name: str) -> dict | None:
	if doctype not in APPROVER_STATES:
		frappe.throw(_("Attachments of {0} are not verified.").format(_(doctype)), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name, for_update=True)
	doc.check_permission("read")
	if not ai_reading.approver_allowed(doc):
		frappe.throw(_("Only an approver at the current workflow step can verify the attachments."), frappe.PermissionError)
	if ai_reading.needs_reading(doc):
		ai_reading.request(doc)
	return ai_reading.state(doc)

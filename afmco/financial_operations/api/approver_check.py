# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.approver_check.engine import approver_allowed
from afmco.approver_check.registry import REGISTRY


@frappe.whitelist(methods=["POST"])
def run(doctype: str, name: str) -> dict:
	if doctype not in REGISTRY:
		frappe.throw(_("The approver check does not cover {0}.").format(doctype), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")
	if not approver_allowed(doc):
		frappe.throw(_("Only an approver at the current workflow step can run the approver check."), frappe.PermissionError)
	return doc.approver_checklist()

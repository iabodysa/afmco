# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint

from afmco.approver_check import engine
from afmco.approver_check.registry import REGISTRY


def approver_doc(doctype: str, name: str):
	if doctype not in REGISTRY:
		frappe.throw(_("The approver check does not cover {0}.").format(doctype), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")
	if not engine.approver_allowed(doc):
		frappe.throw(_("Only an approver at the current workflow step can run the approver check."), frappe.PermissionError)
	return doc


@frappe.whitelist(methods=["POST"])
def run(doctype: str, name: str, retry: int = 0) -> dict:
	doc = approver_doc(doctype, name)
	if cint(retry):
		if engine.RECHECK_ROLE not in frappe.get_roles():
			frappe.throw(_("Only a System Manager can run the check again."), frappe.PermissionError)
		engine.forget(doc)
	return doc.approver_checklist(deferred=True)


@frappe.whitelist(methods=["POST"])
def get_result(doctype: str, name: str) -> dict:
	doc = approver_doc(doctype, name)
	stored = engine.stored_items(doc)
	if not engine.complete(doc, stored):
		return {"pending": True, "modified": str(doc.modified)}
	return engine.serve(doc, stored)

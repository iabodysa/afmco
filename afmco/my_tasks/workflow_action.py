# Copyright (c) 2026, AFMCO and contributors

import frappe
from frappe.query_builder import Criterion, DocType


def get_permission_query_conditions(user):
	user = user or frappe.session.user
	if user == "Administrator":
		return ""

	workflow_doctypes = frappe.get_all("Workflow", filters={"is_active": 1}, pluck="document_type")
	doctypes = workflow_doctypes and frappe.get_all(
		"DocType", filters={"name": ["in", workflow_doctypes]}, pluck="name"
	)
	if not doctypes:
		return ""

	workflow_action = DocType("Workflow Action")
	visible = [workflow_action.reference_doctype.notin(doctypes)] + [
		(workflow_action.reference_doctype == doctype)
		& workflow_action.reference_name.isin(
			frappe.qb.get_query(doctype, fields=["name"], ignore_permissions=False, user=user)
		)
		for doctype in doctypes
		if frappe.has_permission(doctype, "read", user=user)
	]
	readable_actions = frappe.qb.from_(workflow_action).select(workflow_action.name).where(Criterion.any(visible))
	return f"`tabWorkflow Action`.`name` in ({readable_actions.get_sql()})"

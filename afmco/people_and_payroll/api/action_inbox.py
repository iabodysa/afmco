# Copyright (c) 2026, AFMCO and contributors

from __future__ import annotations

import frappe
from frappe.model.workflow import get_transitions, get_workflow_name, get_workflow_state_field

from afmco.people_and_payroll.doctype.action_inbox_settings.action_inbox_settings import get_int


@frappe.whitelist()
def get_pending_actions() -> dict:
	result = _pending(
		get_int("action_inbox_workflow_action_limit"),
		get_int("action_inbox_todo_limit"),
	)
	_attach_transitions(result["workflow_actions"])
	return result


def _attach_transitions(workflow_actions: list) -> None:
	for row in workflow_actions:
		try:
			doc = frappe.get_doc(row["reference_doctype"], row["reference_name"])
			row["transitions"] = get_transitions(doc, raise_exception=False)
		except Exception:
			row["transitions"] = []


def _pending(workflow_limit: int, todo_limit: int) -> dict:
	workflow_actions = frappe.get_list(
		"Workflow Action",
		filters={"status": "Open"},
		fields=["name", "reference_doctype", "reference_name", "workflow_state", "creation"],
		order_by="creation asc",
		limit_page_length=workflow_limit,
	)
	workflow_actions = _current(workflow_actions)
	for wa in workflow_actions:
		wa["source"] = "workflow"

	todos = frappe.get_list(
		"ToDo",
		filters={
			"status": "Open",
			"allocated_to": frappe.session.user,
			"reference_type": ["is", "set"],
		},
		fields=[
			"name",
			"reference_type as reference_doctype",
			"reference_name",
			"description",
			"priority",
			"date",
			"creation",
		],
		order_by="date asc",
		limit_page_length=todo_limit,
	)
	for td in todos:
		td["source"] = "todo"

	return {"workflow_actions": workflow_actions, "todos": todos}


@frappe.whitelist()
def get_pending_action_count(filters=None) -> dict:
	pending = _pending(0, 0)
	return {"value": len(pending["workflow_actions"]) + len(pending["todos"])}


def _current(rows: list) -> list:
	if not rows:
		return rows

	by_doctype: dict[str, list] = {}
	for r in rows:
		by_doctype.setdefault(r["reference_doctype"], []).append(r)

	kept: list = []
	for doctype, group in by_doctype.items():
		if not frappe.db.exists("DocType", doctype):
			continue
		try:
			workflow = get_workflow_name(doctype)
			state_field = get_workflow_state_field(workflow) if workflow else None
			if not state_field:
				kept.extend(group)
				continue
			names = [r["reference_name"] for r in group]
			live = {
				d.name: d.get(state_field)
				for d in frappe.get_all(doctype, filters={"name": ["in", names]}, fields=["name", state_field])
			}
			kept.extend(r for r in group if live.get(r["reference_name"]) == r["workflow_state"])
		except Exception:
			frappe.log_error(title="action_inbox staleness check")
			kept.extend(group)
	return kept

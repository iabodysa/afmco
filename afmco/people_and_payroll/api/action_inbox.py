# Copyright (c) 2026, AFMCO and contributors

from __future__ import annotations

import frappe
from frappe.model.workflow import get_transitions, get_workflow_name, get_workflow_state_field

from afmco.people_and_payroll.doctype.action_inbox_settings.action_inbox_settings import SETTINGS, get_int


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


def _active_states() -> dict[str, list[str]]:
	# Only the document types and states Action Inbox Settings lists as awaiting action
	active = {}
	for row in frappe.get_cached_doc(SETTINGS).document_types:
		states = [s.strip() for s in (row.active_states or "").splitlines() if s.strip()]
		if states and frappe.db.exists("DocType", row.document_type):
			active[row.document_type] = states
	return active


def _workflow_filters(doctype: str, states: list[str]) -> dict:
	return {"status": "Open", "reference_doctype": doctype, "workflow_state": ["in", states]}


def _pending(workflow_limit: int, todo_limit: int) -> dict:
	workflow_actions = []
	for doctype, states in _active_states().items():
		workflow_actions += frappe.get_list(
			"Workflow Action",
			filters=_workflow_filters(doctype, states),
			fields=["name", "reference_doctype", "reference_name", "workflow_state", "creation"],
			order_by="creation desc",
			limit_page_length=workflow_limit,
		)
	workflow_actions.sort(key=lambda r: r["creation"], reverse=True)
	workflow_actions = _current(workflow_actions)[:workflow_limit]
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
	total = 0
	for doctype, states in _active_states().items():
		rows = frappe.get_list(
			"Workflow Action", filters=_workflow_filters(doctype, states), fields=[{"COUNT": "name", "as": "total"}]
		)
		total += (rows[0].get("total") or 0) if rows else 0
	total += frappe.db.count(
		"ToDo", {"status": "Open", "allocated_to": frappe.session.user, "reference_type": ["is", "set"]}
	)
	return {"value": total}


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

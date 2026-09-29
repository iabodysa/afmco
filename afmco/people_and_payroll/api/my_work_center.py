# Copyright (c) 2026, AFMCO and contributors

from __future__ import annotations

import frappe
from frappe.model.workflow import get_workflow_name, get_workflow_state_field
from frappe.utils import add_to_date, get_fullname, now_datetime

from afmco.people_and_payroll.api.action_inbox import get_pending_actions
from afmco.people_and_payroll.doctype.action_inbox_settings.action_inbox_settings import SETTINGS, get_int


def _states(row, kind: str) -> list[str]:
	lines = (row.get(f"{kind}_states") or "").splitlines()
	return [state.strip() for state in lines if state.strip()]


def _state_field(doctype: str) -> str:
	workflow = get_workflow_name(doctype)
	return (workflow and get_workflow_state_field(workflow)) or "status"


def _mine_filters(row, kind: str) -> dict:
	filters: dict = {"owner": frappe.session.user, _state_field(row.document_type): ["in", _states(row, kind)]}
	if row.submitted_only:
		filters["docstatus"] = 1
	if kind == "terminal":
		filters["modified"] = [">=", add_to_date(now_datetime(), hours=-get_int("work_center_recent_hours"))]
	return filters


def _mine(row, kind: str) -> list[dict]:
	doctype = row.document_type
	if not frappe.db.exists("DocType", doctype):
		return []
	if not frappe.has_permission(doctype, "read"):
		return []
	state_field = _state_field(doctype)
	try:
		rows = frappe.get_list(
			doctype,
			filters=_mine_filters(row, kind),
			fields=["name", "modified", state_field],
			order_by="modified desc",
			limit_page_length=50,
		)
	except frappe.PermissionError:
		return []
	for r in rows:
		r["doctype"] = doctype
		r["status"] = r.pop(state_field)
	return rows


def _mine_count(row, kind: str) -> int:
	doctype = row.document_type
	if not frappe.db.exists("DocType", doctype):
		return 0
	if not frappe.has_permission(doctype, "read"):
		return 0
	try:
		rows = frappe.get_list(
			doctype,
			filters=_mine_filters(row, kind),
			fields=[{"COUNT": "name", "as": "total"}],
		)
	except frappe.PermissionError:
		return 0
	return rows[0].get("total") or 0 if rows else 0


def _collect(kind: str) -> list[dict]:
	out: list[dict] = []
	for row in frappe.get_cached_doc(SETTINGS).document_types:
		out.extend(_mine(row, kind))
	out.sort(key=lambda r: r.get("modified") or "", reverse=True)
	return out


def _count(kind: str) -> int:
	return sum(_mine_count(row, kind) for row in frappe.get_cached_doc(SETTINGS).document_types)


@frappe.whitelist()
def get_my_work() -> dict:
	awaiting_action = get_pending_actions()

	my_notifications = frappe.get_list(
		"Notification Log",
		filters={"for_user": frappe.session.user},
		fields=["name", "subject", "type", "document_type", "document_name", "read", "creation"],
		order_by="read asc, creation desc",
		limit_page_length=50,
	)

	my_open_submitted = _collect("active")
	my_recent_closed = _collect("terminal")
	acted_on_my_documents = get_activity_on_my_documents()["documents"]

	workflow_actions = awaiting_action.get("workflow_actions", [])
	todos = awaiting_action.get("todos", [])
	summary = {
		"needs_action": len(workflow_actions) + len(todos),
		"assigned": len(todos),
		"acted_on_my_documents": len(acted_on_my_documents),
		"notifications": len([n for n in my_notifications if not n.get("read")]),
	}

	return {
		"awaiting_action": awaiting_action,
		"my_open_submitted": my_open_submitted,
		"my_recent_closed": my_recent_closed,
		"acted_on_my_documents": acted_on_my_documents,
		"my_notifications": my_notifications,
		"summary": summary,
	}


def _acted_on_filters(since) -> dict:
	return {
		"owner": frappe.session.user,
		"modified_by": ["!=", frappe.session.user],
		"modified": [">=", since],
	}


def _acted_on_by_others(doctype: str, since) -> list[dict]:
	if not frappe.db.exists("DocType", doctype):
		return []
	if not frappe.has_permission(doctype, "read"):
		return []
	fields = ["name", "modified", "modified_by"]
	state_field = _state_field(doctype)
	if frappe.get_meta(doctype).has_field(state_field):
		fields.append(state_field)
	try:
		rows = frappe.get_list(
			doctype,
			filters=_acted_on_filters(since),
			fields=fields,
			order_by="modified desc",
			limit_page_length=20,
		)
	except frappe.PermissionError:
		return []
	for r in rows:
		r["doctype"] = doctype
		if state_field in r:
			r["status"] = r.pop(state_field)
	return rows


def _acted_on_count(doctype: str, since) -> int:
	if not frappe.db.exists("DocType", doctype):
		return 0
	if not frappe.has_permission(doctype, "read"):
		return 0
	try:
		rows = frappe.get_list(
			doctype,
			filters=_acted_on_filters(since),
			fields=[{"COUNT": "name", "as": "total"}],
		)
	except frappe.PermissionError:
		return 0
	return rows[0].get("total") or 0 if rows else 0


@frappe.whitelist()
def get_activity_on_my_documents() -> dict:
	hours = get_int("work_center_activity_hours")
	since = add_to_date(now_datetime(), hours=-hours)
	rows: list[dict] = []
	for row in frappe.get_cached_doc(SETTINGS).document_types:
		rows.extend(_acted_on_by_others(row.document_type, since))

	rows.sort(key=lambda r: r.get("modified") or "", reverse=True)
	rows = rows[:20]

	actors: dict[str, str] = {}
	for r in rows:
		actor = r.get("modified_by")
		if actor and actor not in actors:
			actors[actor] = get_fullname(actor)
		r["actor"] = actors.get(actor) or actor

	return {"documents": rows, "hours": hours}


@frappe.whitelist()
def get_activity_on_my_documents_count(filters=None) -> dict:
	since = add_to_date(now_datetime(), hours=-get_int("work_center_activity_hours"))
	return {
		"value": sum(
			_acted_on_count(row.document_type, since)
			for row in frappe.get_cached_doc(SETTINGS).document_types
		)
	}


@frappe.whitelist()
def get_submitted_by_me_count(filters=None) -> dict:
	return {"value": _count("active")}

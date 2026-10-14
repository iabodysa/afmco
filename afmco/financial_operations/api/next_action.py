# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.model.workflow import (
	get_workflow,
	get_workflow_name,
	has_approval_access,
	is_transition_condition_satisfied,
)
from frappe.permissions import AUTOMATIC_ROLES

DOCTYPE = "Payment Requisition"
SYSTEM_USERS = {"enabled": 1, "user_type": "System User", "name": ("not in", ["Administrator", "Guest"])}


@frappe.whitelist()
def next_action(name: str) -> list[dict]:
	doc = frappe.get_doc(DOCTYPE, name)
	doc.check_permission("read")
	if not get_workflow_name(DOCTYPE):
		return []

	workflow = get_workflow(DOCTYPE)
	state = doc.get(workflow.workflow_state_field)
	transitions = [
		t for t in workflow.transitions if t.state == state and is_transition_condition_satisfied(t, doc)
	]
	if not transitions:
		return []

	next_docstatus = {s.state: int(s.doc_status or 0) for s in workflow.states}
	holders = role_holders({t.allowed for t in transitions})
	system_users = len(frappe.get_all("User", filters=SYSTEM_USERS, pluck="name"))
	steps = {}
	failed = set()
	for transition in transitions:
		users = steps.setdefault(transition.allowed, {})
		ptypes = required_ptypes(doc.docstatus, next_docstatus.get(transition.next_state, 0))
		for user, full_name, image in holders.get(transition.allowed, []):
			if user in users or user in failed or not has_approval_access(user, doc, transition):
				continue
			messages = len(frappe.get_message_log())
			try:
				permitted = all(frappe.has_permission(DOCTYPE, ptype, doc, user=user) for ptype in ptypes)
			except Exception:
				failed.add(user)
				if len(frappe.get_message_log()) > messages:
					frappe.clear_last_message()
				frappe.log_error(
					title=f"Next action permission check failed for {user}",
					reference_doctype=DOCTYPE,
					reference_name=doc.name,
				)
				continue
			if permitted:
				users[user] = {"user": user, "full_name": full_name, "image": image}

	result = []
	for role, users in steps.items():
		everyone = role in AUTOMATIC_ROLES or (users and len(users) >= system_users)
		listed = [] if everyone else sorted(users.values(), key=lambda u: u["full_name"])
		result.append({"role": role, "everyone": bool(everyone), "users": listed})
	return result


def required_ptypes(docstatus: int, next_docstatus: int) -> tuple[str, ...]:
	if next_docstatus == 2:
		return ("cancel",)
	if next_docstatus == 1 and docstatus == 0:
		return ("write", "submit")
	return ("write",)


def role_holders(roles: set[str]) -> dict[str, list[tuple[str, str, str | None]]]:
	has_role = frappe.qb.DocType("Has Role")
	user = frappe.qb.DocType("User")
	rows = (
		frappe.qb.from_(has_role)
		.join(user)
		.on(user.name == has_role.parent)
		.select(has_role.role, user.name, user.full_name, user.user_image)
		.where(has_role.parenttype == "User")
		.where(has_role.role.isin(list(roles)))
		.where(user.enabled == 1)
		.where(user.user_type == "System User")
		.where(user.name.notin(["Administrator", "Guest"]))
		.distinct()
		.run()
	)
	holders = {}
	for role, name, full_name, image in rows:
		holders.setdefault(role, []).append((name, full_name or name, image))
	return holders

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.model.workflow import get_workflow_name
from frappe.utils import get_fullname
from frappe.workflow.doctype.workflow_action.workflow_action import (
	get_doc_workflow_state,
	get_next_possible_transitions,
	get_users_next_action_data,
)


@frappe.whitelist()
def get_next_action_users(doctype: str, name: str) -> list[dict]:
	doc = frappe.get_doc(doctype, name)
	doc.check_permission("read")
	workflow = get_workflow_name(doctype)
	if not workflow:
		return []
	return [
		{
			"action": transition.action,
			"next_state": transition.next_state,
			"role": transition.allowed,
			"users": [
				{"user": user, "full_name": get_fullname(user)}
				for user in get_users_next_action_data([transition], doc)
			],
		}
		for transition in get_next_possible_transitions(
			workflow, get_doc_workflow_state(doc), doc
		)
	]

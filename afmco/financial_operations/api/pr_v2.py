# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

APPROVER_ROLE = "PR v2 Expense Approver"


@frappe.whitelist(methods=["GET"])
def get_expense_approvers():
	users = frappe.get_all("Has Role", filters={"role": APPROVER_ROLE, "parenttype": "User"}, pluck="parent")
	if not users:
		return []
	return frappe.get_all("User", filters={"name": ["in", users], "enabled": 1}, pluck="name")

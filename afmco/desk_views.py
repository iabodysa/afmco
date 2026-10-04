# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.desk.desktop import Workspace

MODULE_LINKED_TYPES = {"doctype": "DocType", "page": "Page", "report": "Report", "dashboard": "Dashboard"}


def is_item_module_blocked(name, item_type):
	linked_doctype = MODULE_LINKED_TYPES.get(item_type.lower())
	if not linked_doctype or not name:
		return False
	blocked_modules = frappe.get_cached_doc("User", frappe.session.user).get_blocked_modules()
	if not blocked_modules:
		return False
	return frappe.db.get_value(linked_doctype, name, "module") in blocked_modules


class BlockedModuleItems:
	def is_item_allowed(self, name, item_type, allowed_workspaces=None):
		if frappe.session.user != "Administrator" and is_item_module_blocked(name, item_type):
			return False
		return super().is_item_allowed(name, item_type, allowed_workspaces)


class AfmcoWorkspace(BlockedModuleItems, Workspace):
	pass

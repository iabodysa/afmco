# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

# import frappe


def execute(filters=None):
	columns, data = [], []
	return columns, data

def execute(filters=None):
	columns, data = [], []
	return columns, data
import frappe
from frappe import _
from frappe.utils import cstr
from frappe.core.doctype.user.user import get_all_roles, get_perm_info

def execute(filters=None):
	columns, data = [], []

	for role in get_all_roles():
		perm_info = get_perm_info(role)
		if perm_info:
			for d in perm_info:
				row = {
					'roles': role, 'doctype': d.parent, 'select': d.select, 'read': d.read, 'write': d.write,
					'create': d.create, 'delete': d.delete, 'submit': d.submit, 'cancel': d.cancel, 'amend': d.amend,
					'print': d.print, 'email': d.email, 'report': d.report, 'import': d.get('import'), 'export': d.export,
					'set_user_permissions': d.set_user_permissions, 'share': d.share, 'indent': 1.0
				}
				data.append(row)

	columns = get_columns()
	return columns, data

def get_columns():
	columns = [
		{
			"label": _("Roles"),
			"fieldname":"roles",
			"fieldtype": "Data",
			"width": 150
		},

		{
			"label": _("Document Type"),
			"fieldname":"doctype",
			"fieldtype": "Data",
			"width": 150
		},
		{
			"label": _("Select"),
			"fieldname":"select",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Read"),
			"fieldname":"read",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Write"),
			"fieldname":"write",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Create"),
			"fieldname":"create",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Delete"),
			"fieldname":"delete",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Submit"),
			"fieldname":"submit",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Cancel"),
			"fieldname":"cancel",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Amend"),
			"fieldname":"amend",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Print"),
			"fieldname":"print",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Email"),
			"fieldname":"email",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Report"),
			"fieldname":"report",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Import"),
			"fieldname":"import",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Export"),
			"fieldname":"export",
			"fieldtype": "Check",
			"width": 70
		},
		{
			"label": _("Set User Permissions"),
			"fieldname":"set_user_permissions",
			"fieldtype": "Check",
			"width": 150
		},
		{
			"label": _("Share"),
			"fieldname":"share",
			"fieldtype": "Check",
			"width": 70
		}
	]
	return columns

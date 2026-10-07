import frappe
from frappe.permissions import add_permission, update_permission_property

ROLE = "Accountant Bot"


def execute():
	add_permission("Comment", ROLE)
	update_permission_property("Comment", ROLE, 0, "create", 1)
	if frappe.db.exists("Custom DocPerm", {"parent": "Payment Requisition"}):
		add_permission("Payment Requisition", ROLE)

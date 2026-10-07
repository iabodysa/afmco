from frappe.permissions import add_permission, update_permission_property

DOCTYPE = "Employee"
ROLES = ("HR Manager", "Payroll User")


def execute():
	for role in ROLES:
		add_permission(DOCTYPE, role, permlevel=1)
		update_permission_property(DOCTYPE, role, 1, "read", 1, validate=False)
		update_permission_property(DOCTYPE, role, 1, "write", 1)

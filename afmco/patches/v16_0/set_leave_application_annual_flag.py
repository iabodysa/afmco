import frappe
from frappe.modules.utils import sync_customizations

FIELD = "annual_leave"


def execute():
	if not frappe.db.has_column("Leave Application", FIELD):
		sync_customizations("afmco")
	leave_application = frappe.qb.DocType("Leave Application")
	leave_type = frappe.qb.DocType("Leave Type")
	(
		frappe.qb.update(leave_application)
		.join(leave_type)
		.on(leave_type.name == leave_application.leave_type)
		.set(leave_application[FIELD], leave_type.is_earned_leave)
		.run()
	)
	print(f"Leave Application: {FIELD} set on {frappe.db.count('Leave Application', {FIELD: 1})} record(s)")

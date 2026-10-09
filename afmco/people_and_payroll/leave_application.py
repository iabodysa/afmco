# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_days, getdate, nowdate

REJOIN_ROLES = frozenset({"HR User", "HR Manager"})


def set_employees_on_leave():
	today = nowdate()
	on_leave_today = frappe.get_all(
		"Leave Application",
		filters={"status": "Approved", "from_date": ("<=", today), "to_date": (">=", today)},
		pluck="employee",
		distinct=True,
	)
	for name in frappe.get_all("Employee", filters={"name": ("in", on_leave_today), "status": "Active"}, pluck="name"):
		frappe.get_doc("Employee", name).db_set("status", "On Leave")


class AfmcoLeaveApplication:
	@frappe.whitelist()
	def rejoin_after_leave(self, date_of_rejoining):
		if not REJOIN_ROLES & set(frappe.get_roles()) or self.docstatus != 1 or self.status != "Approved":
			frappe.throw(_("Not permitted"), frappe.PermissionError)
		date_of_rejoining = self.date_of_rejoing or date_of_rejoining
		employee = frappe.get_doc("Employee", self.employee)
		if employee.status != "On Leave":
			frappe.throw(
				_(
					'The employee is not currently on leave. Please ensure the employee status is "On Leave" before proceeding.',
					context="Leave Application",
				),
				title=_("Error"),
			)
		if getdate(date_of_rejoining) != getdate(add_days(self.to_date, 1)):
			frappe.throw(
				_(
					"The rejoining date must be the day after the leave end date. Please adjust the rejoining date.",
					context="Leave Application",
				),
				title=_("Error"),
			)
		employee.status = "Active"
		employee.custom_date_of_rejoining = date_of_rejoining
		employee.save()
		frappe.msgprint(_("Employee status has been updated to Active.", context="Leave Application"))
		try:
			frappe.get_doc(
				{
					"doctype": "Comment",
					"comment_type": "Info",
					"reference_doctype": "Employee",
					"reference_name": self.employee,
					"content": f"Employee rejoined after leave on {date_of_rejoining}",
				}
			).insert(ignore_permissions=True)
		except Exception:
			frappe.log_error(title="Rejoin after leave comment")
			frappe.msgprint(_("An error occurred while adding the comment. Please try again.", context="Leave Application"))

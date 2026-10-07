# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, flt


@frappe.whitelist(methods=["POST"])
def create_opening_leave_allocations(employee, allocations):
	allocations = frappe.parse_json(allocations)
	employee_doc = frappe.get_doc("Employee", employee)
	employee_doc.check_permission("read")
	if employee_doc.status != "Active":
		frappe.throw(_("Opening leave allocation is only for active employees"))
	if frappe.db.exists("Leave Policy Assignment", {"employee": employee, "docstatus": 1}):
		frappe.throw(_("The employee is already linked to an approved leave policy", context="Employee"))
	if not allocations:
		frappe.throw(_("Add at least one leave type"))

	leave_period = frappe.db.get_value(
		"Leave Period", {"company": employee_doc.company, "is_active": 1}, "name"
	)
	created = []
	for row in allocations:
		allocation = frappe.get_doc(
			{
				"doctype": "Leave Allocation",
				"employee": employee,
				"company": employee_doc.company,
				"department": employee_doc.department,
				"leave_type": row.get("leave_type"),
				"from_date": row.get("from_date"),
				"to_date": row.get("to_date"),
				"new_leaves_allocated": flt(row.get("new_leaves_allocated")),
				"carry_forward": cint(row.get("carry_forward")),
				"leave_period": leave_period,
				"description": _(
					"Opening leave balance for the employee covering the period from the date of joining until the end of the contract year."
				),
			}
		)
		allocation.insert()
		allocation.submit()
		created.append(allocation.name)

	employee_doc.add_comment("Info", _("Opening leave allocations created: {0}").format(", ".join(created)))
	return created

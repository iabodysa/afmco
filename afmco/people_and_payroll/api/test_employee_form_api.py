# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.permissions import add_user_permission
from frappe.tests import IntegrationTestCase

from hrms.hr.doctype.leave_allocation.leave_allocation import OverlapError

from afmco.people_and_payroll.api.employee_dues import get_employee_dues
from afmco.people_and_payroll.api.opening_leave_allocation import create_opening_leave_allocations

COMPANY = "_Test Employee Form Company"
DEPARTMENT = "_Test Employee Form"
VIEWER = "employee-dues-viewer@afmco.test"


def make_department():
	if not frappe.db.exists("Company", COMPANY):
		frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": COMPANY,
				"abbr": "_TEF",
				"default_currency": "SAR",
				"country": "Saudi Arabia",
			}
		).insert()
	filters = {"department_name": DEPARTMENT, "company": COMPANY}
	if not frappe.db.exists("Department", filters):
		frappe.get_doc({"doctype": "Department", **filters}).insert()
	return frappe.db.get_value("Department", filters)


def make_employee(first_name):
	return (
		frappe.get_doc(
			{
				"doctype": "Employee",
				"first_name": first_name,
				"employee_number": first_name,
				"company": COMPANY,
				"department": make_department(),
				"nationality": "Saudi Arabia",
				"gender": "Male",
				"date_of_birth": "1990-01-01",
				"date_of_joining": "2013-01-01",
				"status": "Active",
			}
		)
		.insert()
		.name
	)


class TestEmployeeDues(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("Role", "General Manager"):
			frappe.get_doc({"doctype": "Role", "role_name": "General Manager", "desk_access": 1}).insert()
		self.permitted = make_employee("_T-Dues-Permitted")
		self.hidden = make_employee("_T-Dues-Hidden")
		if not frappe.db.exists("User", VIEWER):
			frappe.get_doc(
				{"doctype": "User", "email": VIEWER, "first_name": "Dues Viewer", "send_welcome_email": 0}
			).insert()
		frappe.get_doc("User", VIEWER).add_roles("General Manager", "HR Manager")
		add_user_permission("Employee", self.permitted, VIEWER)

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_viewer_reads_dues_of_an_employee_they_may_read(self):
		frappe.set_user(VIEWER)
		self.assertEqual(set(get_employee_dues(self.permitted)), {"advance_balance", "monthly_salary"})

	def test_viewer_without_employee_read_is_refused(self):
		frappe.set_user(VIEWER)
		self.assertRaises(frappe.PermissionError, get_employee_dues, self.hidden)

	def test_employee_reader_without_general_manager_is_refused(self):
		frappe.get_doc("User", VIEWER).remove_roles("General Manager")
		frappe.set_user(VIEWER)
		self.assertRaises(frappe.PermissionError, get_employee_dues, self.permitted)


class TestOpeningLeaveAllocation(IntegrationTestCase):
	def setUp(self):
		self.employee = make_employee("_T-Opening-Leave")
		self.leave_types = []
		for name in ("_Test Opening Annual Leave", "_Test Opening Sick Leave"):
			if not frappe.db.exists("Leave Type", name):
				frappe.get_doc({"doctype": "Leave Type", "leave_type_name": name}).insert()
			self.leave_types.append(name)
		self.rows = [
			{"leave_type": leave_type, "from_date": "2013-01-01", "to_date": "2013-12-31", "new_leaves_allocated": 10}
			for leave_type in self.leave_types
		]

	def test_one_call_submits_an_allocation_per_row_without_carry_forward(self):
		created = create_opening_leave_allocations(self.employee, frappe.as_json(self.rows))
		allocations = frappe.get_all(
			"Leave Allocation",
			filters={"name": ("in", created)},
			fields=["leave_type", "docstatus", "carry_forward", "new_leaves_allocated"],
		)
		self.assertEqual({row.leave_type for row in allocations}, set(self.leave_types))
		self.assertEqual(
			{(row.docstatus, row.carry_forward, row.new_leaves_allocated) for row in allocations}, {(1, 0, 10)}
		)
		self.assertTrue(
			frappe.db.exists(
				"Comment",
				{"reference_doctype": "Employee", "reference_name": self.employee, "comment_type": "Info"},
			)
		)

	def test_rerun_for_the_same_period_is_refused(self):
		create_opening_leave_allocations(self.employee, frappe.as_json(self.rows[:1]))
		self.assertRaises(
			OverlapError, create_opening_leave_allocations, self.employee, frappe.as_json(self.rows[:1])
		)

	def test_inactive_employee_is_refused(self):
		frappe.db.set_value("Employee", self.employee, "status", "Left")
		self.assertRaises(
			frappe.ValidationError, create_opening_leave_allocations, self.employee, frappe.as_json(self.rows)
		)

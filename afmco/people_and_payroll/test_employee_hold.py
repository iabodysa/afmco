# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from erpnext.setup.doctype.employee.employee import InactiveEmployeeStatusError
from frappe.tests import IntegrationTestCase
from hrms.hr.doctype.shift_type.shift_type import ShiftType
from hrms.overrides.employee_timesheet import EmployeeTimesheet
from hrms.payroll.doctype.salary_slip.salary_slip import SalarySlip

from afmco.people_and_payroll.test_payroll import make_employee

PAYROLL_ENTRY_MODULE = "hrms.payroll.doctype.payroll_entry.payroll_entry"


def set_status(employee, status):
	doc = frappe.get_doc("Employee", employee)
	doc.status = status
	doc.save()


class TestEmployeeStatusSave(IntegrationTestCase):
	def setUp(self):
		self.employee = make_employee("_T-Hold-Save")

	def tearDown(self):
		frappe.db.rollback()

	def test_employee_saves_with_hold_status(self):
		set_status(self.employee, "Hold")
		self.assertEqual(frappe.db.get_value("Employee", self.employee, "status"), "Hold")

	def test_employee_saves_with_on_leave_status(self):
		set_status(self.employee, "On Leave")
		self.assertEqual(frappe.db.get_value("Employee", self.employee, "status"), "On Leave")

	def test_status_outside_the_options_is_still_rejected(self):
		with self.assertRaises(frappe.ValidationError):
			set_status(self.employee, "Absconded")


class TestHoldExcludedLikeInactive(IntegrationTestCase):
	def setUp(self):
		self.held = make_employee("_T-Hold-Held")
		self.active = make_employee("_T-Hold-Active")
		set_status(self.held, "Hold")

	def tearDown(self):
		frappe.db.rollback()

	def test_payroll_entry_fetch_skips_employee_on_hold(self):
		fetched = [frappe._dict(employee=name, employee_name=name) for name in (self.held, self.active)]
		entry = frappe.new_doc("Payroll Entry")
		entry.update(
			{
				"company": frappe.db.get_value("Employee", self.active, "company"),
				"payroll_frequency": "Monthly",
				"start_date": frappe.utils.get_first_day(frappe.utils.nowdate()),
				"end_date": frappe.utils.get_last_day(frappe.utils.nowdate()),
				"validate_attendance": 0,
			}
		)
		with patch(f"{PAYROLL_ENTRY_MODULE}.get_employee_list", return_value=fetched):
			entry.fill_employee_details()

		self.assertEqual([row.employee for row in entry.employees], [self.active])
		self.assertEqual(entry.number_of_employees, 1)

	def test_attendance_rejects_employee_on_hold(self):
		frappe.new_doc("Attendance", employee=self.active).validate_employee_status()
		with self.assertRaises(InactiveEmployeeStatusError):
			frappe.new_doc("Attendance", employee=self.held).validate_employee_status()

	def test_auto_attendance_skips_employee_on_hold(self):
		with patch.object(ShiftType, "get_assigned_employees", return_value=[self.held, self.active]):
			assigned = frappe.new_doc("Shift Type").get_assigned_employees(frappe.utils.nowdate())

		self.assertEqual(assigned, [self.active])

	def test_timesheet_rejects_employee_on_hold(self):
		with patch.object(EmployeeTimesheet, "validate"):
			frappe.new_doc("Timesheet", employee=self.active).validate()
			with self.assertRaises(InactiveEmployeeStatusError):
				frappe.new_doc("Timesheet", employee=self.held).validate()

	def test_salary_slip_rejects_employee_on_hold(self):
		with patch.object(SalarySlip, "validate"), self.assertRaises(InactiveEmployeeStatusError):
			frappe.new_doc("Salary Slip", employee=self.held).validate()

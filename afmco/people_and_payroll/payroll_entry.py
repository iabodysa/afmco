# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.people_and_payroll.employee import employees_on_hold


class AfmcoPayrollEntry:
	def fill_employee_details(self):
		unmarked = super().fill_employee_details()
		held = employees_on_hold(row.employee for row in self.employees)
		if not held:
			return unmarked
		for row in [row for row in self.employees if row.employee in held]:
			self.remove(row)
		if not self.employees:
			frappe.throw(_("No employees found"))
		self.number_of_employees = len(self.employees)
		return self.get_employees_with_unmarked_attendance()

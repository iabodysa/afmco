# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from afmco.people_and_payroll.employee import validate_not_on_hold


class AfmcoAttendance:
	def validate_employee_status(self):
		super().validate_employee_status()
		validate_not_on_hold(self.employee)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from afmco.people_and_payroll.employee import validate_not_on_hold


class AfmcoTimesheet:
	def validate(self):
		super().validate()
		validate_not_on_hold(self.employee)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from afmco.people_and_payroll.employee import employees_on_hold


class AfmcoShiftType:
	def get_assigned_employees(self, from_date, consider_default_shift=False) -> list[str]:
		employees = super().get_assigned_employees(from_date, consider_default_shift)
		held = employees_on_hold(employees)
		return [employee for employee in employees if employee not in held]

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe


class AfmcoSalarySlip:
	def validate(self):
		super().validate()
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		total = (self.basic33 or 0) + (self.housing33 or 0)
		if self.net_pay > total:
			self.other_allowance33 = self.net_pay - total
		else:
			self.other_allowance33 = 0
		if self.net_pay < total:
			self.deduction33 = total - self.net_pay
		else:
			self.deduction33 = 0
		start_date = frappe.utils.getdate(self.start_date)
		month = frappe.utils.formatdate(start_date, "MMMM")
		year = frappe.utils.formatdate(start_date, "YY")
		self.remark = f"Salary {month} {year}" + "-" + self.employee + "-" + self.employee_name
		for row in self.earnings + self.deductions:
			row.account = frappe.db.get_value(
				"Salary Component Account",
				{"parent": row.salary_component, "company": self.company},
				"account",
				cache=True,
			)

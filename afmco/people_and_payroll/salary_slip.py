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

	def pull_emp_details(self):
		super().pull_emp_details()
		temporary_iban = frappe.db.get_value(
			"Temporary IBAN",
			{"employee": self.employee, "docstatus": 1, "active": 1},
			["name", "iban", "bank_name"],
			as_dict=True,
		)
		self.temporary_iban = temporary_iban.name if temporary_iban else None
		if temporary_iban:
			self.bank_account_no = temporary_iban.iban
			self.bank_name = temporary_iban.bank_name

	def on_submit(self):
		super().on_submit()
		if not (self.temporary_iban and self.payroll_entry):
			return
		temporary_iban = frappe.get_doc("Temporary IBAN", self.temporary_iban)
		if self.payroll_entry in {row.payroll_entry for row in temporary_iban.wps_used}:
			return
		temporary_iban.append("wps_used", {"payroll_entry": self.payroll_entry})
		temporary_iban.save(ignore_permissions=True)

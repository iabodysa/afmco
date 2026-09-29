# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe


class AfmcoLoan:
	def validate(self):
		super().validate()
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.employee = self.applicant

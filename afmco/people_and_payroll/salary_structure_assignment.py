# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe


class AfmcoSalaryStructureAssignment:
	def before_update_after_submit(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.housing_allowance = self.housing

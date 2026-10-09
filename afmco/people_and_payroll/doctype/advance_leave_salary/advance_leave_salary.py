# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from afmco.people_and_payroll.vacation_allowance import apply_settled_periods


class AdvanceLeaveSalary(Document):
	def validate(self):
		apply_settled_periods(self, precision=2)

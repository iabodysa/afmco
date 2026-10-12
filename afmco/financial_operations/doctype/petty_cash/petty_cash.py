# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import add_days


class PettyCash(Document):
	def validate(self):
		if not self.due_date:
			self.set_due_date()

	@frappe.whitelist()
	def set_due_date(self):
		if self.issue_date:
			self.due_date = add_days(self.issue_date, 30)

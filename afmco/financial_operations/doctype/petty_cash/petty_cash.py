# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import add_days


class PettyCash(Document):
	def validate(self):
		if self.issue_date and self.has_value_changed("issue_date"):
			self.due_date = add_days(self.issue_date, 30)

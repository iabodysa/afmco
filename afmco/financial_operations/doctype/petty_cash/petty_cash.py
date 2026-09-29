# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import add_days, flt


class PettyCash(Document):
	def validate(self):
		if self.issue_date and self.has_value_changed("issue_date"):
			self.due_date = add_days(self.issue_date, 30)
		self.balance_remaining = flt(self.petty_cash_amount) - sum(
			flt(row.total_amount) for row in self.liquidation_of_petty_cash
		)

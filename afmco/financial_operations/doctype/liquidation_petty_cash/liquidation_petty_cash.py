# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt


class LiquidationPettyCash(Document):
	def validate(self):
		if self.amount:
			self.tax = flt(self.amount) / 100 * 15
			self.total_amount = flt(self.amount) + self.tax

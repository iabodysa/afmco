# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

PETTY_CASH_ROW_FIELDS = (
	"tax_invoice_number",
	"invoice_date",
	"supplier_name",
	"cr",
	"products",
	"amount",
	"tax",
	"total_amount",
	"notes",
)


class LiquidationPettyCash(Document):
	def validate(self):
		if self.amount:
			self.tax = flt(self.amount) / 100 * 15
			self.total_amount = flt(self.amount) + self.tax

	@frappe.whitelist()
	def sync_to_petty_cash(self):
		if not self.petty_cash_no:
			frappe.throw(_("Petty Cash reference is not set"))
		petty_cash = frappe.get_doc("Petty Cash", self.petty_cash_no)
		row = {field: self.get(field) for field in PETTY_CASH_ROW_FIELDS}
		row["liquidation_petty_cash_no"] = self.name
		petty_cash.append("liquidation_of_petty_cash", row)
		petty_cash.save()
		return petty_cash.name

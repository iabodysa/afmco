# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, get_link_to_form


class AfmcoSalesInvoice:
	def on_submit(self):
		super().on_submit()
		if frappe.db.get_value("Company", self.company, "enable_jv_creation_on_sales_invoice_submit_cf") != 1:
			return
		default_jv_debit_account_cf = frappe.db.get_value("Company", self.company, "default_jv_debit_account_cf")
		default_jv_credit_account_cf = frappe.db.get_value("Company", self.company, "default_jv_credit_account_cf")
		precision = frappe.get_precision("Sales Invoice", "net_total")
		accounts = [
			{
				"account": default_jv_credit_account_cf,
				"credit_in_account_currency": flt(self.net_total, precision),
				"cost_center": self.get("items")[0].cost_center or "",
			},
			{
				"account": default_jv_debit_account_cf,
				"debit_in_account_currency": flt(self.net_total, precision),
				"cost_center": self.get("items")[0].cost_center or "",
			},
		]
		journal_entry = frappe.new_doc("Journal Entry")
		journal_entry.voucher_type = "Journal Entry"
		journal_entry.user_remark = "It is auto created on submit of Sales Invoice {0}".format(self.name)
		journal_entry.company = self.company
		journal_entry.posting_date = self.jv_due_date_cf
		journal_entry.set("accounts", accounts)
		journal_entry.jv_based_on_submitted_si_cf = self.name
		journal_entry.save(ignore_permissions=True)
		journal_entry.submit()
		frappe.msgprint(
			_("Journal Entry {0} is created.".format(frappe.bold(get_link_to_form("Journal Entry", journal_entry.name))))
		)

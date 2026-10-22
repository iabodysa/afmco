# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext.accounts.doctype.journal_entry.journal_entry import JournalEntry
from frappe import _
from frappe.utils import get_link_to_form


class AfmcoJournalEntry(JournalEntry):
	def before_submit(self):
		super().before_submit()
		if (
			self.expense_request_cf
			and frappe.db.get_value("Payment Requisition", self.expense_request_cf, "workflow_state") != "Paid"
		):
			frappe.throw(
				_("Journal Entry cannot be submitted until Payment Requisition {0} is Paid.").format(
					frappe.bold(self.expense_request_cf)
				)
			)

	def validate(self):
		super().validate()
		if not self.expense_request_cf:
			return
		if other := frappe.db.get_value(
			self.doctype,
			{"expense_request_cf": self.expense_request_cf, "docstatus": ["<", 2], "name": ["!=", self.name]},
			"name",
		):
			frappe.msgprint(
				_("Payment Requisition {0} is already linked to Journal Entry {1}.").format(
					frappe.bold(self.expense_request_cf), get_link_to_form(self.doctype, other)
				),
				indicator="orange",
				alert=1,
			)
		frappe.db.set_value("Payment Requisition", self.expense_request_cf, "jv_status", "JV Created")
		frappe.msgprint(
			_(
				"Expencse Request {0} , JV status is updated to <b>JV Created</b>".format(
					frappe.bold(get_link_to_form("Payment Requisition", self.expense_request_cf))
				)
			),
			title=_("Expense Request"),
			alert=1,
		)

	def on_cancel(self):
		super().on_cancel()
		self.mark_expense_request_jv_not_created()

	def on_trash(self):
		super().on_trash()
		self.mark_expense_request_jv_not_created()

	def mark_expense_request_jv_not_created(self):
		if not self.expense_request_cf:
			return
		frappe.db.set_value("Payment Requisition", self.expense_request_cf, "jv_status", "JV Not Created")
		frappe.msgprint(
			_(
				"Expencse Request {0} , JV status is updated to <b>JV Not Created</b>".format(
					frappe.bold(get_link_to_form("Payment Requisition", self.expense_request_cf))
				)
			),
			title=_("Expense Request"),
			alert=1,
		)

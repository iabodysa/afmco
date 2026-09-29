# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cint, get_link_to_form

DRAFT_LIMIT_FIELD = "afmco_journal_entry_draft_limit"


class AfmcoJournalEntry:
	def before_insert(self):
		super().before_insert()
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		if self.is_new():
			limit = cint(frappe.db.get_single_value("Accounts Settings", DRAFT_LIMIT_FIELD))
			if not limit:
				return
			count = frappe.db.count(
				self.doctype,
				filters={
					"owner": frappe.session.user,
					"docstatus": 0,
				},
			)
			if count >= limit:
				frappe.throw(
					_("You cannot create more than {0} drafts. Submit or delete one of your current drafts.").format(limit)
				)

	def before_submit(self):
		super().before_submit()
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		attachments = frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": self.doctype,
				"attached_to_name": self.name,
			},
			limit=1,
		)
		if not attachments:
			frappe.throw(_("The document cannot be approved before the required documents are attached."))

	def validate(self):
		super().validate()
		if not self.expense_request_cf:
			return
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

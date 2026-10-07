# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext import get_default_company
from frappe.utils import  money_in_words

ACCOUNTS_ROLES = ("Accounts User", "Accounts Manager")


class PaymentRequisition(Document):
	def onload(self):
		self.set_onload(
			"accounts_bot_allowed",
			not self.accounts_bot_cf
			and bool(set(ACCOUNTS_ROLES).intersection(frappe.get_roles()))
			and not self.accounts_bot_refusal(),
		)

	def accounts_bot_refusal(self) -> str | None:
		if self.docstatus != 1 or self.workflow_state != "Paid":
			return _("Only a submitted Payment Requisition in Paid state can be sent to the Accounts Bot.")
		if self.jv_status == "JV Created" or frappe.db.exists(
			"Journal Entry", {"expense_request_cf": self.name, "docstatus": ["<", 2]}
		):
			return _("A Journal Entry already exists for this Payment Requisition.")
		return None

	def queue_for_accounts_bot(self) -> str:
		if self.accounts_bot_cf:
			return "already queued"
		if refusal := self.accounts_bot_refusal():
			frappe.throw(refusal)
		self.db_set("accounts_bot_cf", 1, update_modified=True, notify=True)
		self.save_version()
		return "queued"

	def validate(self):
		if self.amount:
			self.amount_in_words=money_in_words(self.amount,frappe.get_cached_value("Company", get_default_company(), "default_currency"))
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.sync_workflow_state_to_jv()
		self.sync_paid_eos_settlement()

	def sync_workflow_state_to_jv(self):
		try:
			linked_jv = frappe.db.get_value("Journal Entry", {"expense_request_cf": self.name}, "name")

			if linked_jv:
				self.jv_status = "JV Created"
				frappe.db.set_value("Journal Entry", linked_jv, "custom_pr_status", self.workflow_state)
		except Exception:
			pass

	def sync_paid_eos_settlement(self):
		if self.workflow_state != "Paid" or not (self.tax_invoice_number or "").startswith("Exit-"):
			return
		settlement = frappe.db.get_value(
			"End of Service Settlement", self.tax_invoice_number, ["workflow_state", "docstatus"], as_dict=True
		)
		if settlement and settlement.workflow_state == "Paid" and settlement.docstatus == 1:
			return
		frappe.db.savepoint("afmco_eos_paid_sync")
		try:
			eos = frappe.get_doc("End of Service Settlement", self.tax_invoice_number)
			eos.update({"workflow_state": "Paid", "docstatus": 1})
			eos.save()
		except Exception:
			frappe.db.rollback(save_point="afmco_eos_paid_sync")
			frappe.log_error(title="EOS Update Failed")
			frappe.msgprint(
				_("The linked EOS document could not be marked as Paid. Please try again."),
				title=_("EOS Update Failed"),
				indicator="red",
			)
		else:
			frappe.msgprint(_("EOS document has been marked as Paid"), indicator="green", alert=True)


def get_permission_query_conditions(user):
	if "System Manager" in frappe.get_roles(user):
		return None
	company = frappe.db.get_single_value("Global Defaults", "default_company")
	frozen_date = company and frappe.db.get_value("Company", company, "accounts_frozen_till_date")
	if frozen_date and frappe.defaults.get_user_default("show_archive_preference", user) != "1":
		return f"`tabPayment Requisition`.`date` > '{frozen_date}'"
	return None

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext import get_default_company
from frappe.utils import escape_html, flt, getdate, money_in_words, now, today
from frappe.utils.html_utils import sanitize_html

from afmco.approver_check import ai_reading
from afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement import mark_settlement_paid

ACCOUNTS_ROLES = ("Accounts User", "Accounts Manager")
ACCOUNTS_BOT_VIEWER_ROLES = (*ACCOUNTS_ROLES, "System Manager")
ACCOUNTS_BOT_ROLE = "Accountant Bot"
REQUEST_SENT = "Request Sent"
JOURNAL_ENTRY_CREATED = "Journal Entry Created"
STOPPED = "Stopped - Needs Review"
RECEIPT_READ = "Receipt Read"
DOCUMENT_UPLOAD = "Document Upload"
RECEIPT_READ_ROLES = ("Auditor", *ACCOUNTS_ROLES)
RECEIPT_FIELDS = ("bank_payment_date", "bank_account", "paid_amount_cf", "beneficiary_employee_cf", "bank_reference_cf")
BENEFICIARY_SHEET_EXTENSIONS = (".xlsx", ".xls", ".csv")
SADAD_NUMBER_FIELDS = ("sadad_biller_code", "sadad_bill_number")


class PaymentRequisition(Document):
	def onload(self):
		roles = set(frappe.get_roles())
		refusal = self.accounts_bot_refusal()
		self.set_onload(
			"accounts_bot_allowed",
			not self.accounts_bot_cf and bool(roles.intersection(ACCOUNTS_ROLES)) and not refusal,
		)
		self.set_onload("accounts_bot_viewer", bool(roles.intersection(ACCOUNTS_BOT_VIEWER_ROLES)))
		receipt_role = bool(roles.intersection(RECEIPT_READ_ROLES)) and not self.receipt_read_refusal()
		self.set_onload("receipt_read_viewer", receipt_role)
		self.set_onload(
			"receipt_read_allowed", receipt_role and not self.receipt_read_pending() and self.has_attachment()
		)
		ai_reading.set_onload(self)

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
		self.db_set(
			{"accounts_bot_cf": 1, "accounts_bot_status": REQUEST_SENT, "accounts_bot_updated": now()},
			update_modified=True,
			notify=True,
		)
		self.save_version()
		return "queued"

	def retry_accounts_bot(self) -> None:
		if self.accounts_bot_status != STOPPED:
			frappe.throw(_("Only a stopped Accounts Bot request can be retried."))
		if refusal := self.accounts_bot_refusal():
			frappe.throw(refusal)
		self.db_set(
			{"accounts_bot_status": REQUEST_SENT, "accounts_bot_note": None, "accounts_bot_updated": now()},
			update_modified=True,
			notify=True,
		)

	def receipt_read_refusal(self) -> str | None:
		if self.workflow_state != DOCUMENT_UPLOAD:
			return _("Only a Payment Requisition in Document Upload state can be read by the Accounts Bot.")
		return None

	def receipt_read_pending(self) -> bool:
		return bool(self.accounts_bot_read_receipt_cf) and self.accounts_bot_status not in (RECEIPT_READ, STOPPED)

	def has_attachment(self) -> bool:
		return bool(frappe.db.exists("File", {"attached_to_doctype": self.doctype, "attached_to_name": self.name}))

	def queue_receipt_read(self) -> str:
		if refusal := self.receipt_read_refusal():
			frappe.throw(refusal)
		if not self.has_attachment():
			frappe.throw(_("Attach the bank receipt before asking the Accounts Bot to read it."))
		if self.receipt_read_pending():
			return "already queued"
		self.db_set(
			{
				"accounts_bot_read_receipt_cf": 1,
				"accounts_bot_status": REQUEST_SENT,
				"accounts_bot_note": None,
				"accounts_bot_updated": now(),
			},
			update_modified=True,
			notify=True,
		)
		self.save_version()
		return "queued"

	def fill_payment_fields(self, values: dict) -> dict:
		if refusal := self.receipt_read_refusal():
			frappe.throw(refusal)
		if not isinstance(values, dict):
			frappe.throw(_("Payment fields must be sent as an object."))
		if unknown := sorted(set(values) - set(RECEIPT_FIELDS)):
			frappe.throw(_("The Accounts Bot cannot write {0}.").format(", ".join(unknown)))
		changes, skipped = {}, []
		for fieldname, value in values.items():
			if self.get(fieldname):
				skipped.append({"field": fieldname, "reason": "not empty"})
			else:
				changes[fieldname] = self.receipt_value(fieldname, value)
		if changes:
			self.db_set(dict(changes), update_modified=True, notify=True)
			self.save_version()
			self.add_comment(
				"Comment",
				_("Filled by Accounts Bot: {0}").format(
					", ".join(f"{_(self.meta.get_label(f))}: {escape_html(str(v))}" for f, v in changes.items())
				),
			)
		return {"written": list(changes), "skipped": skipped}

	def receipt_value(self, fieldname: str, value):
		if fieldname == "bank_payment_date":
			paid_on = getdate(value) if isinstance(value, str) and value else None
			if not paid_on or paid_on > getdate(today()) or (self.date and paid_on < getdate(self.date)):
				frappe.throw(_("{0} is not a bank payment date for this Payment Requisition.").format(value))
			return paid_on
		if fieldname == "bank_account":
			company = frappe.db.get_single_value("Global Defaults", "default_company")
			account = isinstance(value, str) and frappe.db.get_value(
				"Account", value, ["account_type", "company", "is_group", "disabled"], as_dict=True
			)
			if not account or account.account_type != "Bank" or account.is_group or account.disabled or account.company != company:
				frappe.throw(_("{0} is not a bank account of {1}.").format(value, company))
			return value
		if fieldname == "paid_amount_cf":
			if isinstance(value, bool) or not isinstance(value, (int, float, str)) or flt(value) <= 0:
				frappe.throw(_("{0} is not a paid amount.").format(value))
			return flt(value, self.precision(fieldname))
		if fieldname == "beneficiary_employee_cf":
			if not isinstance(value, str) or frappe.db.get_value("Employee", value, "status") != "Active":
				frappe.throw(_("{0} is not an active employee.").format(value))
			return value
		reference = value.strip() if isinstance(value, str) else ""
		if not reference or len(reference) > 140:
			frappe.throw(_("{0} is not a bank reference.").format(value))
		return reference

	def set_accounts_bot_status(self, status: str, note: str | None = None) -> None:
		if not status or status not in self.meta.get_options("accounts_bot_status").split("\n"):
			frappe.throw(_("{0} is not an Accounts Bot status.").format(status))
		if self.accounts_bot_status == JOURNAL_ENTRY_CREATED and status != JOURNAL_ENTRY_CREATED:
			frappe.throw(_("The Accounts Bot already created the Journal Entry for this Payment Requisition."))
		values = {
			"accounts_bot_status": status,
			"accounts_bot_note": sanitize_html(note, always_sanitize=True) if note else None,
			"accounts_bot_updated": now(),
		}
		self.db_set(values, update_modified=False)
		frappe.publish_realtime(
			"accounts_bot_status",
			{"name": self.name, "status": status, "note": values["accounts_bot_note"], "updated": values["accounts_bot_updated"]},
			doctype=self.doctype,
			docname=self.name,
			after_commit=True,
		)

	def validate(self):
		if self.amount:
			self.amount_in_words=money_in_words(self.amount,frappe.get_cached_value("Company", get_default_company(), "default_currency"))
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.apply_multiple_beneficiaries()
		self.validate_sadad_numbers()
		self.sync_workflow_state_to_jv()
		self.sync_paid_eos_settlement()

	def apply_multiple_beneficiaries(self):
		if not self.multiple_beneficiaries:
			return
		self.account_no = None
		for fieldname in SADAD_NUMBER_FIELDS:
			self.set(fieldname, None)
		leaving_state = self._action == "submit" or self.has_value_changed("workflow_state")
		if not self.is_new() and leaving_state and not self.has_beneficiary_sheet():
			frappe.throw(
				_("Attach the beneficiaries sheet (Excel or CSV) before sending a Payment Requisition with multiple beneficiaries."),
				title=_("Beneficiaries Sheet Missing"),
			)

	def validate_sadad_numbers(self):
		for fieldname in SADAD_NUMBER_FIELDS:
			value = self.get(fieldname)
			if value and not (value.isascii() and value.isdigit()):
				frappe.throw(
					_("{0} must contain digits only.").format(_(self.meta.get_label(fieldname))),
					title=_("Invalid SADAD Number"),
				)

	def has_beneficiary_sheet(self) -> bool:
		file_names = frappe.get_all(
			"File",
			filters={"attached_to_doctype": self.doctype, "attached_to_name": self.name},
			pluck="file_name",
		)
		return any((name or "").lower().endswith(BENEFICIARY_SHEET_EXTENSIONS) for name in file_names)

	def sync_workflow_state_to_jv(self):
		try:
			linked_jv = frappe.db.get_value("Journal Entry", {"expense_request_cf": self.name}, "name")

			if linked_jv:
				self.jv_status = "JV Created"
				frappe.db.set_value("Journal Entry", linked_jv, "pr_status", self.workflow_state)
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
			mark_settlement_paid(self.tax_invoice_number)
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

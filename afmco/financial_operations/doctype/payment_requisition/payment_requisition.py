# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json
import re

import frappe
from frappe import _
from frappe.model.document import Document
from erpnext import get_default_company
from frappe.utils import add_days, escape_html, flt, getdate, money_in_words, now, strip_html, today
from frappe.utils.html_utils import sanitize_html

from afmco.approver_check import ai_reading
from afmco.financial_operations import accounts_bot_choice, accounts_bot_run
from afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement import mark_settlement_paid

ACCOUNTS_ROLES = ("Accounts User", "Accounts Manager")
ACCOUNTS_BOT_VIEWER_ROLES = (*ACCOUNTS_ROLES, "System Manager")
ACCOUNTS_BOT_ROLE = "Accountant Bot"
REQUEST_SENT = "Request Sent"
JOURNAL_ENTRY_CREATED = "Journal Entry Created"
STOPPED = "Stopped - Needs Review"
RECEIPT_READ = "Receipt Read"
ACCOUNTS_BOT_IDLE = (None, "", JOURNAL_ENTRY_CREATED, RECEIPT_READ, STOPPED)
DOCUMENT_UPLOAD = "Document Upload"
ACCOUNTS_BOT_STATES = {DOCUMENT_UPLOAD: 0, "Paid": 1}
PAYMENT_DATE_STATES = (DOCUMENT_UPLOAD, "Paid")
PRELIMINARY_FIELD = "accounts_bot_preliminary"
RECEIPT_READ_ROLES = ("Auditor", *ACCOUNTS_ROLES)
RECEIPT_FIELDS = ("bank_payment_date", "bank_account", "paid_amount_cf", "bank_reference_cf", "remark")
RECEIPT_COMPARED_FIELDS = ("bank_payment_date", "bank_account", "paid_amount_cf", "remark")
JOURNAL_ENTRY_LOCKED_FIELDS = ("bank_payment_date", "bank_account", "bank_reference_cf", "paid_amount_cf")
SADAD_NUMBER_FIELDS = ("sadad_biller_code", "sadad_bill_number")
SADAD_PAYMENT = "SADAD Payment"
BANK_TRANSFER = "Bank Transfer"
SAUDI_IBAN = re.compile(r"SA\d{22}")
STOP_QUESTION_TAG = "[accounts-bot-stop-question q="
STOP_QUESTION = re.compile(r"^\[accounts-bot-stop-question q=([A-Za-z0-9_.-]+)\]$")
STOP_ANSWER_LIMIT = 500


class PaymentRequisition(Document):
	def onload(self):
		roles = set(frappe.get_roles())
		refusal = self.accounts_bot_refusal()
		self.set_onload(
			"accounts_bot_allowed",
			not self.request_pending()
			and (not self.accounts_bot_cf or self.preliminary_update_due())
			and bool(roles.intersection(ACCOUNTS_ROLES))
			and not refusal,
		)
		self.set_onload("accounts_bot_viewer", bool(roles.intersection(ACCOUNTS_BOT_VIEWER_ROLES)))
		if roles.intersection(ACCOUNTS_BOT_VIEWER_ROLES):
			self.set_onload("accounts_bot_choice", accounts_bot_choice.open_choice(self.name))
		receipt_role = bool(roles.intersection(RECEIPT_READ_ROLES)) and not self.receipt_read_refusal()
		self.set_onload("receipt_read_viewer", receipt_role)
		if self.request_pending() and not self.accounts_bot_read_receipt_cf and roles.intersection(ACCOUNTS_BOT_VIEWER_ROLES):
			self.set_onload("accounts_bot_expected_finish", accounts_bot_run.expected_finish(self.name, self.payment_type))
		self.set_onload("payment_dates", self.payment_dates())
		self.set_onload("journal_entry_locked", self.journal_entry_submitted())
		self.set_onload("workflow_states_seen", self.workflow_states_seen())
		if self.amount:
			currency = frappe.get_cached_value("Company", get_default_company(), "default_currency")
			self.set_onload("amount_in_words", money_in_words(self.amount, currency))
		ai_reading.set_onload(self)

	def workflow_states_seen(self) -> list[str]:
		seen = set()
		versions = frappe.get_all(
			"Version",
			filters={"ref_doctype": self.doctype, "docname": self.name, "data": ["like", '%"workflow_state"%']},
			pluck="data",
		)
		for data in versions:
			for fieldname, old, new in json.loads(data or "{}").get("changed") or []:
				if fieldname == "workflow_state":
					seen.update(value for value in (old, new) if value)
		return sorted(seen)

	def journal_entry_submitted(self) -> bool:
		return bool(frappe.db.exists("Journal Entry", {"expense_request_cf": self.name, "docstatus": 1}))

	def refuse_journal_entry_locked(self, fieldnames) -> None:
		locked = [fieldname for fieldname in fieldnames if fieldname in JOURNAL_ENTRY_LOCKED_FIELDS]
		if locked and self.journal_entry_submitted():
			frappe.throw(
				_("A submitted Journal Entry exists for this Payment Requisition. {0} cannot be changed.").format(
					", ".join(_(self.meta.get_label(fieldname)) for fieldname in locked)
				)
			)

	def before_update_after_submit(self):
		self.refuse_journal_entry_locked(
			[fieldname for fieldname in JOURNAL_ENTRY_LOCKED_FIELDS if self.has_value_changed(fieldname)]
		)

	def payment_dates(self) -> list[tuple[str, str]]:
		if self.workflow_state not in PAYMENT_DATE_STATES:
			return []
		journal_entries = frappe.get_all(
			"Journal Entry",
			filters={"expense_request_cf": self.name, "docstatus": ["<", 2]},
			fields=["name", "posting_date", "docstatus", PRELIMINARY_FIELD],
			order_by="posting_date asc",
		)
		return [
			(row.name, row.posting_date) for row in journal_entries if row.docstatus or not row.get(PRELIMINARY_FIELD)
		]

	def accounts_bot_state_refusal(self) -> str | None:
		if ACCOUNTS_BOT_STATES.get(self.workflow_state) != self.docstatus:
			return _("Only a Payment Requisition in Document Upload or Paid state can be sent to the Accounts Bot.")
		return None

	def accounts_bot_refusal(self) -> str | None:
		if refusal := self.accounts_bot_state_refusal():
			return refusal
		journal_entries = frappe.get_all(
			"Journal Entry",
			filters={"expense_request_cf": self.name, "docstatus": ["<", 2]},
			fields=["docstatus", PRELIMINARY_FIELD],
		)
		if any(row.docstatus or not row.get(PRELIMINARY_FIELD) for row in journal_entries) or (
			self.jv_status == "JV Created" and not journal_entries
		):
			return _("A Journal Entry already exists for this Payment Requisition.")
		return None

	def request_pending(self) -> bool:
		return self.accounts_bot_status not in ACCOUNTS_BOT_IDLE

	def preliminary_update_due(self) -> bool:
		return self.accounts_bot_status != STOPPED and not self.request_pending() and bool(
			frappe.db.exists(
				"Journal Entry", {"expense_request_cf": self.name, "docstatus": 0, PRELIMINARY_FIELD: 1}
			)
		)

	def queue_for_accounts_bot(self) -> str:
		if self.receipt_read_pending():
			frappe.throw(_("The Accounts Bot is reading the receipt of this Payment Requisition. Send it for a Journal Entry after the reading finishes."))
		if self.accounts_bot_cf and not self.preliminary_update_due():
			return "already queued"
		if refusal := self.accounts_bot_refusal():
			frappe.throw(refusal)
		self.db_set(
			{
				"accounts_bot_cf": 1,
				"accounts_bot_read_receipt_cf": 0,
				"accounts_bot_status": REQUEST_SENT,
				"accounts_bot_note": None,
				"accounts_bot_updated": now(),
			},
			update_modified=True,
			notify=True,
		)
		self.save_version()
		return "queued"

	def retry_accounts_bot(self) -> None:
		if self.accounts_bot_status != STOPPED:
			frappe.throw(_("Only a stopped Accounts Bot request can be retried."))
		if refusal := self.receipt_read_refusal() if self.accounts_bot_read_receipt_cf else self.accounts_bot_refusal():
			frappe.throw(refusal)
		self.db_set(
			{"accounts_bot_status": REQUEST_SENT, "accounts_bot_note": None, "accounts_bot_updated": now()},
			update_modified=True,
			notify=True,
		)
		self.save_version()

	def latest_stop_question(self) -> str | None:
		for content in frappe.get_all(
			"Comment",
			filters={
				"reference_doctype": self.doctype,
				"reference_name": self.name,
				"comment_type": "Info",
				"content": ["like", f"%{STOP_QUESTION_TAG}%"],
			},
			order_by="creation desc",
			pluck="content",
		):
			first_line = next(
				(line for part in re.split(r"\r?\n|<br\s*/?>", content or "", flags=re.I) if (line := strip_html(part).strip())),
				"",
			)
			if match := STOP_QUESTION.match(first_line):
				return match.group(1)
		return None

	def answer_accounts_bot(self, question: str, answer: str) -> None:
		if self.accounts_bot_status != STOPPED:
			frappe.throw(_("Only a stopped Accounts Bot request can be answered."))
		if not question or question != self.latest_stop_question():
			frappe.throw(_("This Accounts Bot question is no longer open. Reload the form."))
		answer = (answer or "").strip()
		if not answer or len(answer) > STOP_ANSWER_LIMIT:
			frappe.throw(_("Write an answer of up to {0} characters.").format(STOP_ANSWER_LIMIT))
		self.add_comment("Info", f"[accounts-bot-stop-answer q={question}] {escape_html(answer)}")
		self.retry_accounts_bot()

	def answer_accounts_bot_choice(self, question: str, button: str) -> None:
		choice = accounts_bot_choice.open_choice(self.name)
		if not question or not choice or choice["q"] != question:
			frappe.throw(_("This Accounts Bot question is no longer open. Reload the form."))
		if button not in {entry["id"] for entry in choice["buttons"]}:
			frappe.throw(_("{0} is not a choice of this Accounts Bot question.").format(escape_html(str(button))))
		if self.request_pending():
			frappe.throw(_("The Accounts Bot is still working on this Payment Requisition. Choose again after it finishes."))
		asker = accounts_bot_choice.presser(self.name)
		self.add_comment("Info", f"{accounts_bot_choice.ANSWER_TAG.format(question)} {button}")
		if self.accounts_bot_status == STOPPED:
			self.retry_accounts_bot()
		elif self.queue_for_accounts_bot() != "queued":
			frappe.throw(_("The Accounts Bot could not take this answer. Reload the form."))
		accounts_bot_choice.publish_close(self.name, question, asker)

	def receipt_read_refusal(self) -> str | None:
		if self.workflow_state != DOCUMENT_UPLOAD:
			return _("Only a Payment Requisition in Document Upload state can be read by the Accounts Bot.")
		return None

	def receipt_read_pending(self) -> bool:
		return bool(self.accounts_bot_read_receipt_cf) and self.request_pending()

	def has_attachment(self) -> bool:
		return bool(frappe.db.exists("File", {"attached_to_doctype": self.doctype, "attached_to_name": self.name}))

	def queue_receipt_read(self) -> str:
		if refusal := self.receipt_read_refusal():
			frappe.throw(refusal)
		if not self.has_attachment():
			frappe.throw(_("Attach the bank receipt before asking the Accounts Bot to read it."))
		if self.receipt_read_pending():
			return "already queued"
		if self.request_pending():
			frappe.throw(_("The Accounts Bot is preparing the Journal Entry of this Payment Requisition. Ask it to read the receipt after it finishes."))
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
		if refusal := self.accounts_bot_state_refusal():
			frappe.throw(refusal)
		if not isinstance(values, dict):
			frappe.throw(_("Payment fields must be sent as an object."))
		if unknown := sorted(set(values) - set(RECEIPT_FIELDS)):
			frappe.throw(_("The Accounts Bot cannot write {0}.").format(", ".join(unknown)))
		changes, sources, skipped = {}, {}, []
		for fieldname, entry in values.items():
			value, source = (entry.get("value"), entry.get("source")) if isinstance(entry, dict) else (entry, None)
			current = self.get(fieldname)
			if current and fieldname not in RECEIPT_COMPARED_FIELDS:
				skipped.append({"field": fieldname, "reason": "not empty"})
				continue
			value, source = self.receipt_value(fieldname, value), self.receipt_source(source)
			if fieldname == "paid_amount_cf":
				current = flt(current, self.precision(fieldname)) if current else current
			elif fieldname == "bank_payment_date":
				current = getdate(current) if current else current
			if current == value:
				skipped.append({"field": fieldname, "reason": "unchanged"})
			elif current and fieldname == "bank_account" and (reason := self.bank_account_keep_reason(current)):
				skipped.append({"field": fieldname, "reason": reason})
			else:
				changes[fieldname], sources[fieldname] = value, source
		self.refuse_journal_entry_locked(changes)
		before = {fieldname: self.get(fieldname) for fieldname in changes}
		if changes:
			self.db_set(dict(changes), update_modified=True, notify=True)
			self.save_version()
		for fieldname, source in sources.items():
			self.add_comment(
				"Info",
				_("Accounts Bot changed {0} from {1} to {2}. Source file: {3}").format(
					_(self.meta.get_label(fieldname)),
					*(escape_html(str(v)) if v else "-" for v in (before[fieldname], changes[fieldname], source)),
				),
			)
		return {
			"written": list(sources),
			"skipped": skipped,
			"pending": [],
		}

	def bank_account_keep_reason(self, current: str) -> str | None:
		company = frappe.db.get_single_value("Global Defaults", "default_company")
		operating = frappe.db.get_value(
			"Bank Account", {"company": company, "is_company_account": 1, "is_default": 1, "disabled": 0}, "account"
		)
		if not operating:
			return "operating account not set"
		if current == operating:
			return "operating account"
		return None

	def receipt_source(self, source) -> str | None:
		if not source:
			return None
		attached = {"attached_to_doctype": self.doctype, "attached_to_name": self.name}
		for key in ("name", "file_url", "file_name"):
			if isinstance(source, str) and (file_name := frappe.db.get_value("File", {**attached, key: source}, "file_name")):
				return file_name
		frappe.throw(_("{0} is not a file attached to this Payment Requisition.").format(source))

	def receipt_value(self, fieldname: str, value):
		if fieldname == "bank_payment_date":
			paid_on = getdate(value) if isinstance(value, str) and value else None
			if not paid_on or paid_on > getdate(today()) or paid_on < getdate(self.creation):
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
		if fieldname == "remark":
			remark = value.strip() if isinstance(value, str) else ""
			if not remark:
				frappe.throw(_("{0} is not a remark.").format(value))
			return remark
		reference = value.strip() if isinstance(value, str) else ""
		if not reference or len(reference) > 140:
			frappe.throw(_("{0} is not a bank reference.").format(value))
		return reference

	def set_accounts_bot_status(self, status: str, note: str | None = None) -> None:
		if not status or status not in self.meta.get_options("accounts_bot_status").split("\n"):
			frappe.throw(_("{0} is not an Accounts Bot status.").format(status))
		if self.accounts_bot_status == JOURNAL_ENTRY_CREATED and status != JOURNAL_ENTRY_CREATED:
			frappe.throw(_("The Accounts Bot already created the Journal Entry for this Payment Requisition."))
		previous = self.accounts_bot_status
		values = {
			"accounts_bot_status": status,
			"accounts_bot_note": sanitize_html(note, always_sanitize=True) if note else None,
			"accounts_bot_updated": now(),
		}
		if status == RECEIPT_READ:
			values["accounts_bot_read_receipt_cf"] = 0
		self.db_set(values, update_modified=False)
		frappe.publish_realtime(
			"accounts_bot_status",
			{"name": self.name, "status": status, "note": values["accounts_bot_note"], "updated": values["accounts_bot_updated"]},
			doctype=self.doctype,
			docname=self.name,
			after_commit=True,
		)
		if status in accounts_bot_choice.FINISHED and status != previous:
			if choice := accounts_bot_choice.open_choice(self.name):
				accounts_bot_choice.publish_choice(choice, 1)
			accounts_bot_run.announce_finish(self.name, status)

	def validate(self):
		if self.amount:
			self.amount_in_words=money_in_words(self.amount,frappe.get_cached_value("Company", get_default_company(), "default_currency"))
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.apply_multiple_beneficiaries()
		self.set_mode_of_payment()
		self.validate_urgency_reason()
		self.validate_iban()
		self.validate_sadad_numbers()
		self.sync_workflow_state_to_jv()
		self.sync_paid_eos_settlement()

	def apply_multiple_beneficiaries(self):
		if not self.multiple_beneficiaries:
			return
		self.account_no = None
		for fieldname in SADAD_NUMBER_FIELDS:
			self.set(fieldname, None)

	def set_mode_of_payment(self):
		if self.is_new() or self.has_value_changed("payment_type"):
			self.mode_of_payment = SADAD_PAYMENT if self.payment_type == SADAD_PAYMENT else BANK_TRANSFER

	def validate_urgency_reason(self):
		changed = self.has_value_changed("if_it__urgent") or self.has_value_changed("reason_of_urgency")
		if self.if_it__urgent and changed and not (self.reason_of_urgency or "").strip():
			frappe.throw(_("Enter the reason of urgency."), title=_("Urgent"))

	def validate_iban(self):
		if not self.account_no or self.payment_type == SADAD_PAYMENT or not self.has_value_changed("account_no"):
			return
		if not SAUDI_IBAN.fullmatch(self.account_no):
			frappe.throw(
				_("Please verify the accuracy of the IBAN to avoid errors during banking transactions."),
				title=_("Invalid IBAN"),
			)

	def validate_sadad_numbers(self):
		for fieldname in SADAD_NUMBER_FIELDS:
			value = self.get(fieldname)
			if value and not (value.isascii() and value.isdigit()):
				frappe.throw(
					_("{0} must contain digits only.").format(_(self.meta.get_label(fieldname))),
					title=_("Invalid SADAD Number"),
				)

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


def set_sadad_bill(request, biller, bills):
	request.multiple_beneficiaries = int(len(bills) > 1)
	if len(bills) == 1:
		request.sadad_biller_code = biller
		request.sadad_bill_number = bills[0]


def get_permission_query_conditions(user):
	if "System Manager" in frappe.get_roles(user):
		return None
	company = frappe.db.get_single_value("Global Defaults", "default_company")
	frozen_date = company and frappe.db.get_value("Company", company, "accounts_frozen_till_date")
	if frozen_date and frappe.defaults.get_user_default("show_archive_preference", user) != "1":
		return f"`tabPayment Requisition`.`creation` >= '{add_days(frozen_date, 1)}'"
	return None

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.approver_check import ai_reading
from afmco.approver_check.registry import APPROVER_STATES, PAYMENT_REQUISITION
from afmco.afmco import accounts_bot_run
from afmco.afmco.doctype.payment_requisition.payment_requisition import (
	ACCOUNTS_BOT_ROLE,
	ACCOUNTS_BOT_VIEWER_ROLES,
	ACCOUNTS_ROLES,
	RECEIPT_READ_ROLES,
)


def locked_requisition(name: str):
	requisition = frappe.get_doc("Payment Requisition", name, for_update=True)
	requisition.check_permission("read")
	return requisition


@frappe.whitelist(methods=["POST"])
def set_accounts_bot(name: str) -> str:
	frappe.only_for(ACCOUNTS_ROLES)
	requisition = locked_requisition(name)
	result = requisition.queue_for_accounts_bot()
	if result == "queued":
		accounts_bot_run.announce_expected_finish(requisition)
	return result


@frappe.whitelist(methods=["POST"])
def retry_accounts_bot(name: str) -> None:
	frappe.only_for(ACCOUNTS_BOT_VIEWER_ROLES)
	requisition = locked_requisition(name)
	requisition.retry_accounts_bot()
	if not requisition.accounts_bot_read_receipt_cf:
		accounts_bot_run.announce_expected_finish(requisition)


@frappe.whitelist(methods=["POST"])
def answer_accounts_bot(name: str, q: str, answer: str) -> None:
	frappe.only_for(ACCOUNTS_BOT_VIEWER_ROLES)
	locked_requisition(name).answer_accounts_bot(q, answer)


@frappe.whitelist(methods=["POST"])
def answer_accounts_bot_choice(name: str, q: str, id: str) -> None:
	frappe.only_for(ACCOUNTS_BOT_VIEWER_ROLES)
	locked_requisition(name).answer_accounts_bot_choice(q, id)


@frappe.whitelist(methods=["POST"])
def set_accounts_bot_status(name: str, status: str, note: str | None = None) -> None:
	frappe.only_for(ACCOUNTS_BOT_ROLE)
	locked_requisition(name).set_accounts_bot_status(status, note)


@frappe.whitelist(methods=["POST"])
def save_reading(name: str, reading: dict | str, doctype: str = PAYMENT_REQUISITION) -> None:
	frappe.only_for(ACCOUNTS_BOT_ROLE)
	if doctype not in APPROVER_STATES:
		frappe.throw(_("Attachment readings are not kept for {0}.").format(_(doctype)), frappe.PermissionError)
	doc = frappe.get_doc(doctype, name, for_update=True)
	doc.check_permission("read")
	ai_reading.save(doc, reading)


@frappe.whitelist(methods=["POST"])
def request_receipt_read(name: str) -> str:
	frappe.only_for(RECEIPT_READ_ROLES)
	return locked_requisition(name).queue_receipt_read()


@frappe.whitelist(methods=["POST"])
def fill_payment_fields(name: str, values: dict | str) -> dict:
	frappe.only_for(ACCOUNTS_BOT_ROLE)
	return locked_requisition(name).fill_payment_fields(frappe.parse_json(values))


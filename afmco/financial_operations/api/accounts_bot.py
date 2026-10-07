# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

from afmco.financial_operations.doctype.payment_requisition.payment_requisition import (
	ACCOUNTS_BOT_ROLE,
	ACCOUNTS_BOT_VIEWER_ROLES,
	ACCOUNTS_ROLES,
)


def locked_requisition(name: str):
	requisition = frappe.get_doc("Payment Requisition", name, for_update=True)
	requisition.check_permission("read")
	return requisition


@frappe.whitelist(methods=["POST"])
def set_accounts_bot(name: str) -> str:
	frappe.only_for(ACCOUNTS_ROLES)
	return locked_requisition(name).queue_for_accounts_bot()


@frappe.whitelist(methods=["POST"])
def retry_accounts_bot(name: str) -> None:
	frappe.only_for(ACCOUNTS_BOT_VIEWER_ROLES)
	locked_requisition(name).retry_accounts_bot()


@frappe.whitelist(methods=["POST"])
def set_accounts_bot_status(name: str, status: str, note: str | None = None) -> None:
	frappe.only_for(ACCOUNTS_BOT_ROLE)
	locked_requisition(name).set_accounts_bot_status(status, note)

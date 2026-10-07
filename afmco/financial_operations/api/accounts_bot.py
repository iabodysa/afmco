# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

from afmco.financial_operations.doctype.payment_requisition.payment_requisition import ACCOUNTS_ROLES


@frappe.whitelist(methods=["POST"])
def set_accounts_bot(name: str) -> str:
	frappe.only_for(ACCOUNTS_ROLES)
	requisition = frappe.get_doc("Payment Requisition", name, for_update=True)
	requisition.check_permission("read")
	return requisition.queue_for_accounts_bot()

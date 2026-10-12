# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

from afmco.people_and_payroll.iqama_bank_file import attach


@frappe.whitelist(methods=["POST"])
def attach_bank_file(payment_requisition):
	return attach(payment_requisition)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

from afmco.people_and_payroll.iqama_bank_file import create_with_bank_file


@frappe.whitelist(methods=["POST"])
def create_payment_requisition(payment_requisition, payment_type, trackers=None):
	return create_with_bank_file(payment_requisition, payment_type, trackers)

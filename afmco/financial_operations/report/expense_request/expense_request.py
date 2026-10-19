# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

FIELDS = [
	"name",
	"creation",
	"beneficiary_name",
	"amount",
	"payment_type",
	"mode_of_payment",
	"workflow_state",
	"if_it__urgent",
	"reason_of_urgency",
	"account_no",
	"sadad_biller_code",
	"sadad_bill_number",
	"jv_status",
	"cost_center",
	"project",
	"tax_invoice_number",
	"bank_payment_date",
	"bank_account",
]


def execute(filters=None):
	results = frappe.get_all("Payment Requisition", fields=FIELDS, filters=filters, order_by="creation DESC")
	for row in results:
		row.account_no = row.account_no or " / ".join(filter(None, (row.sadad_biller_code, row.sadad_bill_number)))
	return get_columns(), results, None


def get_columns():
	return [
		{"fieldname": "name", "label": _("Request ID"), "fieldtype": "Link", "options": "Payment Requisition", "width": 150},
		{"fieldname": "creation", "label": _("Date"), "fieldtype": "Date", "width": 120},
		{"fieldname": "beneficiary_name", "label": _("Beneficiary Name"), "fieldtype": "Data", "width": 150},
		{"fieldname": "amount", "label": _("Amount"), "fieldtype": "Currency", "width": 120},
		{"fieldname": "payment_type", "label": _("Payment Type"), "fieldtype": "Data", "width": 150},
		{"fieldname": "mode_of_payment", "label": _("Mode of Payment"), "fieldtype": "Data", "width": 150},
		{"fieldname": "workflow_state", "label": _("Workflow State"), "fieldtype": "Data", "width": 150},
		{"fieldname": "if_it__urgent", "label": _("Urgent"), "fieldtype": "Check", "width": 80},
		{"fieldname": "reason_of_urgency", "label": _("Reason of Urgency"), "fieldtype": "Data", "width": 200},
		{"fieldname": "account_no", "label": _("Account No"), "fieldtype": "Data", "width": 150},
		{"fieldname": "jv_status", "label": _("JV Status"), "fieldtype": "Data", "width": 120},
		{"fieldname": "cost_center", "label": _("Cost Center"), "fieldtype": "Data", "width": 150},
		{"fieldname": "project", "label": _("Project"), "fieldtype": "Link", "options": "Project", "width": 150},
		{"fieldname": "tax_invoice_number", "label": _("Tax Invoice Number"), "fieldtype": "Data", "width": 150},
		{"fieldname": "bank_payment_date", "label": _("Bank Payment Date"), "fieldtype": "Date", "width": 150},
		{"fieldname": "bank_account", "label": _("Bank Account"), "fieldtype": "Link", "options": "Account", "width": 150},
	]

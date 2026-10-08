import frappe

FIELD = "afmco_general_ledger_month_limit"
DEFAULT = 3


def execute():
	if frappe.db.exists("Singles", {"doctype": "Accounts Settings", "field": FIELD}):
		return
	frappe.db.set_single_value("Accounts Settings", FIELD, DEFAULT)

import frappe

FIELD = "afmco_journal_entry_draft_limit"
DEFAULT = 50


def execute():
	if frappe.db.exists("Singles", {"doctype": "Accounts Settings", "field": FIELD}):
		return
	frappe.db.set_single_value("Accounts Settings", FIELD, DEFAULT)

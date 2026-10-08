import frappe
from frappe.utils import cint

MONTH_LIMIT_FIELD = "afmco_general_ledger_month_limit"
SHIPPED_MONTH_LIMIT = 3
MEMORY_LIMIT_FIELD = "afmco_general_ledger_memory_limit_mb"
MEMORY_LIMIT_MB = 2048


def execute():
	if cint(frappe.db.get_single_value("Accounts Settings", MONTH_LIMIT_FIELD)) == SHIPPED_MONTH_LIMIT:
		frappe.db.set_single_value("Accounts Settings", MONTH_LIMIT_FIELD, 0)
	if not cint(frappe.db.get_single_value("Accounts Settings", MEMORY_LIMIT_FIELD)):
		frappe.db.set_single_value("Accounts Settings", MEMORY_LIMIT_FIELD, MEMORY_LIMIT_MB)

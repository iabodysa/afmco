# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import add_months, cint, getdate

GENERAL_LEDGER = "General Ledger"
MONTH_LIMIT_FIELD = "afmco_general_ledger_month_limit"
NARROWING_FILTERS = ("account", "party", "voucher_no", "against_voucher_no")
FULL_HISTORY_CATEGORIES = (
	"Categorize by Account",
	"Categorize by Party",
	"Group by Account",
	"Group by Party",
)


def validate_general_ledger_filters(filters) -> None:
	limit = cint(frappe.db.get_single_value("Accounts Settings", MONTH_LIMIT_FIELD))
	if not limit:
		return
	filters = frappe._dict(frappe.parse_json(filters) or {})
	if any(filters.get(key) for key in NARROWING_FILTERS):
		return
	category = filters.get("categorize_by") or filters.get("group_by")
	if category in FULL_HISTORY_CATEGORIES and not cint(filters.get("disable_opening_balance_calculation")):
		frappe.throw(
			_(
				"Categorize by Account or by Party reads every entry since the company began. Select an Account or a Party, or tick Disable Opening Balance Calculation."
			)
		)
	if not (filters.get("from_date") and filters.get("to_date")):
		return
	if getdate(filters.to_date) >= add_months(getdate(filters.from_date), limit):
		frappe.throw(
			_(
				"A General Ledger without an Account, Party or Voucher filter covers at most {0} months. Shorten the dates or add a filter."
			).format(limit)
		)


class AfmcoReport:
	def execute_script_report(self, filters):
		if self.name == GENERAL_LEDGER:
			validate_general_ledger_filters(filters)
		return super().execute_script_report(filters)

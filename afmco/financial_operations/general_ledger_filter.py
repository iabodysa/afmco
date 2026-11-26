# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from erpnext.accounts.doctype.accounting_dimension.accounting_dimension import get_accounting_dimensions

LEDGER_REPORTS = frozenset(("General Ledger", "General Ledger Afmco"))
NARROWING_FILTERS = ("account", "party", "cost_center", "project", "voucher_no", "against_voucher_no")


def is_ledger_report(report_name):
	while report_name:
		if report_name in LEDGER_REPORTS:
			return True
		report_name = frappe.db.get_value("Report", report_name, "reference_report")
	return False


def require_narrowing_filter(filters):
	filters = frappe.parse_json(filters or {})
	if not isinstance(filters, dict):
		filters = {}
	dimensions = [
		d.fieldname for d in get_accounting_dimensions(as_list=False) if d.document_type != "Finance Book"
	]
	if not any(filters.get(f) not in (None, "", [], "[]") for f in (*NARROWING_FILTERS, *dimensions)):
		frappe.throw(
			_("Select at least one filter such as Account, Party, Cost Center or Voucher No to run this report."),
			title=_("Filter Required"),
		)


class AfmcoReport:
	def execute_script_report(self, filters):
		if self.name in LEDGER_REPORTS:
			require_narrowing_filter(filters)
		return super().execute_script_report(filters)


class AfmcoPreparedReport:
	def before_insert(self):
		if is_ledger_report(self.report_name):
			require_narrowing_filter(self.filters)
		super().before_insert()

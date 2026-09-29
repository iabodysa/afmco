# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext.accounts.report.bank_reconciliation_statement import (
	bank_reconciliation_statement as stock,
)
from erpnext.accounts.utils import get_balance_on
from frappe import _
from frappe.utils import flt, getdate


def execute(filters=None):
	if not filters or not filters.get("from_date") or not filters.get("account"):
		return stock.execute(filters)

	filters = frappe._dict(filters)
	account_currency = frappe.get_cached_value("Account", filters.account, "account_currency")
	from_date = getdate(filters.from_date)

	data = [d for d in stock.get_entries(filters) if getdate(d["posting_date"]) >= from_date]
	total_debit = sum(flt(d.debit) for d in data)
	total_credit = sum(flt(d.credit) for d in data)

	balance_as_per_system = get_balance_on(filters["account"], filters["report_date"])
	amounts_not_reflected_in_system = stock.get_amounts_not_reflected_in_system(filters)
	bank_bal = flt(balance_as_per_system) - total_debit + total_credit + amounts_not_reflected_in_system

	data += [
		stock.get_balance_row(
			_("Bank Statement balance as per General Ledger"), balance_as_per_system, account_currency
		),
		{},
		{
			"payment_entry": _("Outstanding Cheques and Deposits to clear"),
			"debit": total_debit,
			"credit": total_credit,
			"account_currency": account_currency,
		},
		stock.get_balance_row(
			_("Cheques and Deposits incorrectly cleared"), amounts_not_reflected_in_system, account_currency
		),
		{},
		stock.get_balance_row(_("Calculated Bank Statement balance"), bank_bal, account_currency),
	]

	return stock.get_columns(), data

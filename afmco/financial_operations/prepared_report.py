# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.financial_operations.general_ledger_bound import GENERAL_LEDGER, validate_general_ledger_filters

ACTIVE_STATUSES = ("Queued", "Started")


class AfmcoPreparedReport:
	def before_insert(self):
		super().before_insert()
		if self.report_name == GENERAL_LEDGER:
			validate_general_ledger_filters(self.filters)
		if frappe.db.exists(
			"Prepared Report",
			{
				"owner": frappe.session.user,
				"report_name": self.report_name,
				"status": ("in", ACTIVE_STATUSES),
			},
		):
			frappe.throw(
				_("You already have {0} being prepared. Wait for it to finish or delete it before starting another.").format(
					_(self.report_name)
				)
			)

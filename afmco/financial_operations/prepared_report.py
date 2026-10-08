# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.core.doctype.prepared_report.prepared_report import REPORT_TIMEOUT
from frappe.utils.background_jobs import enqueue

from afmco.financial_operations.general_ledger_bound import validate_general_ledger_filters
from afmco.financial_operations.general_ledger_queue import (
	general_ledger_queue,
	generate_general_ledger,
	is_general_ledger,
)

ACTIVE_STATUSES = ("Queued", "Started")


class AfmcoPreparedReport:
	def before_insert(self):
		super().before_insert()
		if is_general_ledger(self.report_name):
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

	def after_insert(self):
		if not is_general_ledger(self.report_name):
			return super().after_insert()
		enqueue(
			generate_general_ledger,
			queue=general_ledger_queue(),
			prepared_report=self.name,
			timeout=frappe.get_value("Report", self.report_name, "timeout") or REPORT_TIMEOUT,
			enqueue_after_commit=True,
			at_front_when_starved=True,
		)

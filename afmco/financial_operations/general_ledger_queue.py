# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import resource

import frappe
from frappe import _
from frappe.core.doctype.prepared_report.prepared_report import generate_report
from frappe.utils import cint
from frappe.utils.background_jobs import get_queues_timeout

from afmco.financial_operations.general_ledger_bound import GENERAL_LEDGER

GENERAL_LEDGER_QUEUE = "general_ledger"
FALLBACK_QUEUE = "long"
MEMORY_LIMIT_FIELD = "afmco_general_ledger_memory_limit_mb"
MEGABYTE = 1024 * 1024


def is_general_ledger(report_name: str) -> bool:
	if report_name == GENERAL_LEDGER:
		return True
	return frappe.db.get_value("Report", report_name, "reference_report") == GENERAL_LEDGER


def general_ledger_queue() -> str:
	if GENERAL_LEDGER_QUEUE in get_queues_timeout():
		return GENERAL_LEDGER_QUEUE
	return FALLBACK_QUEUE


def data_limit_for(limit_mb: int, hard: int) -> int:
	cap = limit_mb * MEGABYTE
	if hard == resource.RLIM_INFINITY:
		return cap
	return min(cap, hard)


def generate_general_ledger(prepared_report: str) -> None:
	limit_mb = cint(frappe.db.get_single_value("Accounts Settings", MEMORY_LIMIT_FIELD))
	soft, hard = resource.getrlimit(resource.RLIMIT_DATA)
	if limit_mb:
		resource.setrlimit(resource.RLIMIT_DATA, (data_limit_for(limit_mb, hard), hard))
	try:
		generate_report(prepared_report)
	except MemoryError:
		resource.setrlimit(resource.RLIMIT_DATA, (soft, hard))
		frappe.db.rollback()
		frappe.db.set_value(
			"Prepared Report",
			prepared_report,
			{
				"status": "Error",
				"error_message": _(
					"General Ledger stopped because it needed more than {0} MB of memory. Add an Account, Party or Voucher filter or shorten the dates."
				).format(limit_mb),
			},
		)
		frappe.db.commit()
	finally:
		resource.setrlimit(resource.RLIMIT_DATA, (soft, hard))

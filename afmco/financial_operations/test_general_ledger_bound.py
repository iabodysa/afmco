# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.core.doctype.report.report import Report
from frappe.tests import IntegrationTestCase

from afmco.financial_operations.general_ledger_bound import GENERAL_LEDGER, MONTH_LIMIT_FIELD

OTHER_REPORT = "Accounts Receivable"


def ledger_filters(**overrides) -> dict:
	filters = {
		"company": "_Test Bound Company",
		"from_date": "2026-01-01",
		"to_date": "2026-03-31",
		"categorize_by": "Categorize by Voucher (Consolidated)",
	}
	filters.update(overrides)
	return filters


def prepare(report_name: str, filters: dict) -> str:
	return (
		frappe.get_doc({"doctype": "Prepared Report", "report_name": report_name, "filters": frappe.as_json(filters)})
		.insert(ignore_permissions=True)
		.name
	)


class TestGeneralLedgerBound(IntegrationTestCase):
	def setUp(self):
		frappe.db.set_single_value("Accounts Settings", MONTH_LIMIT_FIELD, 3)
		frappe.db.delete("Prepared Report")
		fetch = patch.object(Report, "execute_module", return_value=([], []))
		self.fetch = fetch.start()
		self.addCleanup(fetch.stop)
		enqueue = patch("frappe.core.doctype.prepared_report.prepared_report.enqueue")
		enqueue.start()
		self.addCleanup(enqueue.stop)
		ledger_enqueue = patch("afmco.financial_operations.prepared_report.enqueue")
		ledger_enqueue.start()
		self.addCleanup(ledger_enqueue.stop)

	def run_report(self, report_name: str, filters: dict):
		report = frappe.get_doc("Report", report_name)
		report.snapshot_report = 0
		return report.execute_script_report(filters)

	def test_unfiltered_ledger_beyond_month_limit_is_refused_before_fetch(self):
		with self.assertRaises(frappe.ValidationError):
			self.run_report(GENERAL_LEDGER, ledger_filters(to_date="2026-04-01"))
		self.fetch.assert_not_called()

	def test_unfiltered_ledger_within_month_limit_runs(self):
		self.run_report(GENERAL_LEDGER, ledger_filters())
		self.fetch.assert_called_once()

	def test_account_filter_lifts_month_limit(self):
		self.run_report(GENERAL_LEDGER, ledger_filters(to_date="2026-12-31", account=["Cash - TBC"]))
		self.fetch.assert_called_once()

	def test_party_filter_lifts_month_limit(self):
		self.run_report(
			GENERAL_LEDGER, ledger_filters(to_date="2026-12-31", party_type="Customer", party=["_Test Customer"])
		)
		self.fetch.assert_called_once()

	def test_empty_party_list_keeps_month_limit(self):
		with self.assertRaises(frappe.ValidationError):
			self.run_report(GENERAL_LEDGER, ledger_filters(to_date="2026-12-31", party=[]))
		self.fetch.assert_not_called()

	def test_categorize_by_account_without_account_or_party_is_refused_before_fetch(self):
		with self.assertRaises(frappe.ValidationError):
			self.run_report(
				GENERAL_LEDGER, ledger_filters(to_date="2026-01-31", categorize_by="Categorize by Account")
			)
		self.fetch.assert_not_called()

	def test_legacy_group_by_party_without_party_is_refused_before_fetch(self):
		with self.assertRaises(frappe.ValidationError):
			self.run_report(
				GENERAL_LEDGER, ledger_filters(to_date="2026-01-31", categorize_by=None, group_by="Group by Party")
			)
		self.fetch.assert_not_called()

	def test_categorize_by_account_with_opening_disabled_runs_within_month_limit(self):
		self.run_report(
			GENERAL_LEDGER,
			ledger_filters(categorize_by="Categorize by Account", disable_opening_balance_calculation=1),
		)
		self.fetch.assert_called_once()

	def test_zero_month_limit_runs_any_range(self):
		frappe.db.set_single_value("Accounts Settings", MONTH_LIMIT_FIELD, 0)
		self.run_report(GENERAL_LEDGER, ledger_filters(to_date="2030-12-31", categorize_by="Categorize by Account"))
		self.fetch.assert_called_once()

	def test_other_report_is_not_bounded(self):
		self.run_report(OTHER_REPORT, {"company": "_Test Bound Company", "report_date": "2030-12-31"})
		self.fetch.assert_called_once()

	def test_prepared_ledger_beyond_month_limit_is_refused_at_insert(self):
		with self.assertRaises(frappe.ValidationError):
			prepare(GENERAL_LEDGER, ledger_filters(to_date="2026-12-31"))
		self.assertFalse(frappe.db.exists("Prepared Report", {"report_name": GENERAL_LEDGER}))

	def test_second_active_prepared_report_of_same_report_is_refused(self):
		prepare(GENERAL_LEDGER, ledger_filters())
		with self.assertRaises(frappe.ValidationError):
			prepare(GENERAL_LEDGER, ledger_filters(from_date="2026-02-01"))
		self.assertEqual(frappe.db.count("Prepared Report", {"report_name": GENERAL_LEDGER}), 1)

	def test_completed_prepared_report_allows_next(self):
		first = prepare(GENERAL_LEDGER, ledger_filters())
		frappe.db.set_value("Prepared Report", first, "status", "Completed")
		prepare(GENERAL_LEDGER, ledger_filters(from_date="2026-02-01"))
		self.assertEqual(frappe.db.count("Prepared Report", {"report_name": GENERAL_LEDGER}), 2)

	def test_active_prepared_report_of_another_report_allows_insert(self):
		prepare(OTHER_REPORT, {"company": "_Test Bound Company", "report_date": "2026-03-31"})
		prepare(GENERAL_LEDGER, ledger_filters())
		self.assertEqual(frappe.db.count("Prepared Report", {"status": "Queued"}), 2)

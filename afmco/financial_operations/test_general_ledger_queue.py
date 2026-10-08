# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import resource
from unittest.mock import patch

import frappe
from frappe.core.doctype.report.report import Report
from frappe.modules.utils import sync_customizations
from frappe.tests import IntegrationTestCase

from afmco.financial_operations.general_ledger_bound import GENERAL_LEDGER, MONTH_LIMIT_FIELD
from afmco.financial_operations.general_ledger_queue import (
	GENERAL_LEDGER_QUEUE,
	MEGABYTE,
	MEMORY_LIMIT_FIELD,
	generate_general_ledger,
)
from afmco.patches.v16_0.set_general_ledger_queue_defaults import execute as set_queue_defaults

OTHER_REPORT = "Accounts Receivable"
CUSTOM_LEDGER = "_Test Custom General Ledger"
QUEUES_WITH_LEDGER = {"short": 300, "default": 300, "long": 1500, GENERAL_LEDGER_QUEUE: 1500}
QUEUES_WITHOUT_LEDGER = {"short": 300, "default": 300, "long": 1500}
LEDGER_FILTERS = {
	"company": "_Test Queue Company",
	"from_date": "2023-01-01",
	"to_date": "2026-09-30",
	"categorize_by": "Categorize by Voucher (Consolidated)",
}


def prepare(report_name: str) -> str:
	return (
		frappe.get_doc(
			{"doctype": "Prepared Report", "report_name": report_name, "filters": frappe.as_json(LEDGER_FILTERS)}
		)
		.insert(ignore_permissions=True)
		.name
	)


def custom_ledger() -> str:
	if not frappe.db.exists("Report", CUSTOM_LEDGER):
		frappe.get_doc(
			{
				"doctype": "Report",
				"report_name": CUSTOM_LEDGER,
				"ref_doctype": "GL Entry",
				"report_type": "Custom Report",
				"reference_report": GENERAL_LEDGER,
				"is_standard": "No",
				"module": "Accounts",
			}
		).insert(ignore_permissions=True)
	return CUSTOM_LEDGER


class TestGeneralLedgerQueue(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		super().setUpClass()
		sync_customizations("afmco")

	def setUp(self):
		frappe.db.set_single_value("Accounts Settings", MONTH_LIMIT_FIELD, 0)
		frappe.db.set_single_value("Accounts Settings", MEMORY_LIMIT_FIELD, 2048)
		frappe.db.delete("Prepared Report")
		self.ledger_enqueue = self.start("afmco.financial_operations.prepared_report.enqueue")
		self.frappe_enqueue = self.start("frappe.core.doctype.prepared_report.prepared_report.enqueue")
		self.queues = self.start("afmco.financial_operations.general_ledger_queue.get_queues_timeout")
		self.queues.return_value = QUEUES_WITH_LEDGER
		self.limit_before = (resource.RLIM_INFINITY, resource.RLIM_INFINITY)
		self.getrlimit = self.start("afmco.financial_operations.general_ledger_queue.resource.getrlimit")
		self.getrlimit.return_value = self.limit_before
		self.setrlimit = self.start("afmco.financial_operations.general_ledger_queue.resource.setrlimit")

	def start(self, target: str):
		patcher = patch(target)
		self.addCleanup(patcher.stop)
		return patcher.start()

	def test_general_ledger_prepared_run_goes_to_dedicated_queue_when_a_worker_is_declared(self):
		name = prepare(GENERAL_LEDGER)
		self.ledger_enqueue.assert_called_once()
		args, kwargs = self.ledger_enqueue.call_args
		self.assertIs(args[0], generate_general_ledger)
		self.assertEqual(kwargs["queue"], GENERAL_LEDGER_QUEUE)
		self.assertEqual(kwargs["prepared_report"], name)
		self.assertTrue(kwargs["enqueue_after_commit"])
		self.frappe_enqueue.assert_not_called()

	def test_general_ledger_prepared_run_falls_back_to_long_queue_without_a_declared_worker(self):
		self.queues.return_value = QUEUES_WITHOUT_LEDGER
		prepare(GENERAL_LEDGER)
		self.assertEqual(self.ledger_enqueue.call_args.kwargs["queue"], "long")

	def test_custom_report_of_general_ledger_goes_to_dedicated_queue(self):
		prepare(custom_ledger())
		self.assertEqual(self.ledger_enqueue.call_args.kwargs["queue"], GENERAL_LEDGER_QUEUE)
		self.frappe_enqueue.assert_not_called()

	def test_other_report_keeps_frappe_long_queue(self):
		prepare(OTHER_REPORT)
		self.ledger_enqueue.assert_not_called()
		self.assertEqual(self.frappe_enqueue.call_args.kwargs["queue"], "long")

	def test_zero_month_limit_lets_unfiltered_multi_year_ledger_run(self):
		with patch.object(Report, "execute_module", return_value=([], [])) as fetch:
			report = frappe.get_doc("Report", GENERAL_LEDGER)
			report.snapshot_report = 0
			report.execute_script_report(LEDGER_FILTERS)
		fetch.assert_called_once()

	def test_ledger_run_holds_data_limit_at_setting_and_restores_it(self):
		seen = []
		with patch(
			"afmco.financial_operations.general_ledger_queue.generate_report",
			side_effect=lambda name: seen.append(self.setrlimit.call_args),
		):
			generate_general_ledger(prepare(GENERAL_LEDGER))
		self.assertEqual(seen[0].args, (resource.RLIMIT_DATA, (2048 * MEGABYTE, resource.RLIM_INFINITY)))
		self.assertEqual(self.setrlimit.call_args.args, (resource.RLIMIT_DATA, self.limit_before))

	def test_zero_memory_limit_leaves_data_limit_untouched(self):
		frappe.db.set_single_value("Accounts Settings", MEMORY_LIMIT_FIELD, 0)
		seen = []
		with patch(
			"afmco.financial_operations.general_ledger_queue.generate_report",
			side_effect=lambda name: seen.append(self.setrlimit.call_args),
		):
			generate_general_ledger(prepare(GENERAL_LEDGER))
		self.assertIsNone(seen[0])

	def test_memory_error_marks_prepared_report_error_and_restores_limit(self):
		name = prepare(GENERAL_LEDGER)
		with (
			patch("afmco.financial_operations.general_ledger_queue.generate_report", side_effect=MemoryError),
			patch.object(frappe.db, "commit"),
			patch.object(frappe.db, "rollback"),
		):
			generate_general_ledger(name)
		status, message = frappe.db.get_value("Prepared Report", name, ["status", "error_message"])
		self.assertEqual(status, "Error")
		self.assertIn("2048 MB", message)
		self.assertEqual(self.setrlimit.call_args.args, (resource.RLIMIT_DATA, self.limit_before))

	def test_defaults_patch_turns_shipped_month_limit_off_and_sets_memory_limit(self):
		frappe.db.set_single_value("Accounts Settings", MONTH_LIMIT_FIELD, 3)
		frappe.db.set_single_value("Accounts Settings", MEMORY_LIMIT_FIELD, 0)
		set_queue_defaults()
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", MONTH_LIMIT_FIELD), 0)
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", MEMORY_LIMIT_FIELD), 2048)

	def test_defaults_patch_keeps_month_limit_the_owner_chose(self):
		frappe.db.set_single_value("Accounts Settings", MONTH_LIMIT_FIELD, 12)
		frappe.db.set_single_value("Accounts Settings", MEMORY_LIMIT_FIELD, 3072)
		set_queue_defaults()
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", MONTH_LIMIT_FIELD), 12)
		self.assertEqual(frappe.db.get_single_value("Accounts Settings", MEMORY_LIMIT_FIELD), 3072)

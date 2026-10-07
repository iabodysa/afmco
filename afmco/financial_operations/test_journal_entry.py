# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from afmco.financial_operations.test_requisition_pack import make_journal_entry, make_pdf, make_requisition


def attach_evidence(journal_entry: str) -> None:
	frappe.get_doc(
		{
			"doctype": "File",
			"file_name": f"{journal_entry}-evidence.pdf",
			"attached_to_doctype": "Journal Entry",
			"attached_to_name": journal_entry,
			"is_private": 1,
			"content": make_pdf(300),
		}
	).insert()


def submit(journal_entry: str) -> None:
	attach_evidence(journal_entry)
	frappe.get_doc("Journal Entry", journal_entry).submit()


def amend(journal_entry: str) -> str:
	original = frappe.get_doc("Journal Entry", journal_entry)
	amended = frappe.copy_doc(original)
	amended.docstatus = 0
	amended.amended_from = original.name
	return amended.insert().name


def jv_status(requisition: str) -> str:
	return frappe.db.get_value("Payment Requisition", requisition, "jv_status")


class TestJournalEntryRequisitionLink(IntegrationTestCase):
	def test_amended_journal_entry_keeps_requisition_and_marks_jv_created(self):
		requisition = make_requisition()
		original = make_journal_entry(requisition)
		submit(original)
		frappe.get_doc("Journal Entry", original).cancel()
		self.assertEqual(jv_status(requisition), "JV Not Created")

		amended = amend(original)

		self.assertEqual(frappe.db.get_value("Journal Entry", amended, "expense_request_cf"), requisition)
		self.assertEqual(jv_status(requisition), "JV Created")
		submit(amended)
		self.assertEqual(jv_status(requisition), "JV Created")

	def test_requisition_status_sync_targets_active_journal_entry(self):
		requisition = make_requisition()
		original = make_journal_entry(requisition)
		submit(original)
		frappe.get_doc("Journal Entry", original).cancel()
		amended = amend(original)
		frappe.db.set_value("Journal Entry", original, "user_remark", "touched after amendment")
		doc = frappe.get_doc("Payment Requisition", requisition)
		doc.workflow_state = "Paid"

		with patch("frappe.db.set_value") as set_value:
			doc.sync_workflow_state_to_jv()

		set_value.assert_called_once_with("Journal Entry", amended, "custom_pr_status", "Paid")

	def test_second_active_journal_entry_for_requisition_is_refused(self):
		requisition = make_requisition()
		make_journal_entry(requisition)

		with self.assertRaises(frappe.UniqueValidationError):
			make_journal_entry(requisition)

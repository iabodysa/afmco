# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.permissions import add_permission, update_permission_property
from frappe.tests import IntegrationTestCase

from afmco.financial_operations.api.accounts_bot import (
	retry_accounts_bot,
	set_accounts_bot,
	set_accounts_bot_status,
)
from afmco.financial_operations.api.requisition_pack import attach_pack
from afmco.financial_operations.test_journal_entry import submit
from afmco.financial_operations.test_requisition_pack import make_journal_entry, make_pdf, make_requisition
from afmco.patches.v16_0 import grant_accountant_bot_permissions

ACCOUNTS_USER = "accounts-bot-clerk@example.com"
OTHER_USER = "accounts-bot-outsider@example.com"
BOT_USER = "accounts-bot@example.com"
READER_ROLE = "System Manager"


def make_user(email: str, roles: tuple[str, ...]) -> str:
	if not frappe.db.exists("User", email):
		frappe.get_doc({"doctype": "User", "email": email, "first_name": email.split("@")[0]}).insert()
	frappe.get_doc("User", email).add_roles(*roles)
	return email


def make_paid_requisition() -> str:
	requisition = make_requisition()
	frappe.get_doc("Payment Requisition", requisition).submit()
	frappe.db.set_value("Payment Requisition", requisition, "workflow_state", "Paid", update_modified=False)
	return requisition


def bot_versions(requisition: str) -> list[dict]:
	return frappe.get_all(
		"Version",
		filters={
			"ref_doctype": "Payment Requisition",
			"docname": requisition,
			"data": ["like", "%accounts_bot_cf%"],
		},
		fields=["owner", "data"],
	)


def button_shown(requisition: str) -> bool:
	doc = frappe.get_doc("Payment Requisition", requisition)
	doc.run_method("onload")
	return bool(doc.get_onload().get("accounts_bot_allowed"))


class TestAccountsBot(IntegrationTestCase):
	def setUp(self):
		make_user(ACCOUNTS_USER, ("Accounts User", READER_ROLE))
		make_user(OTHER_USER, (READER_ROLE,))
		make_user(BOT_USER, ("Accountant Bot",))

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_button_shows_only_for_accounts_role_on_paid_unflagged_requisition_without_journal_entry(self):
		paid = make_paid_requisition()
		draft = make_requisition()
		unpaid = make_requisition()
		frappe.get_doc("Payment Requisition", unpaid).submit()
		with_entry = make_paid_requisition()
		make_journal_entry(with_entry)
		flagged = make_paid_requisition()
		frappe.db.set_value("Payment Requisition", flagged, "accounts_bot_cf", 1)

		frappe.set_user(ACCOUNTS_USER)
		self.assertTrue(button_shown(paid))
		self.assertFalse(button_shown(draft))
		self.assertFalse(button_shown(unpaid))
		self.assertFalse(button_shown(with_entry))
		self.assertFalse(button_shown(flagged))
		frappe.set_user(OTHER_USER)
		self.assertFalse(button_shown(paid))

	def test_set_accounts_bot_flags_bumps_modified_notifies_and_records_version_by_presser(self):
		requisition = make_paid_requisition()
		before = frappe.db.get_value("Payment Requisition", requisition, "modified")

		frappe.set_user(ACCOUNTS_USER)
		with patch("frappe.publish_realtime") as publish:
			self.assertEqual(set_accounts_bot(requisition), "queued")
		frappe.set_user("Administrator")

		flag, modified, modified_by = frappe.db.get_value(
			"Payment Requisition", requisition, ["accounts_bot_cf", "modified", "modified_by"]
		)
		self.assertEqual(flag, 1)
		self.assertEqual(
			frappe.db.get_value("Payment Requisition", requisition, "accounts_bot_status"), "Request Sent"
		)
		self.assertGreater(modified, before)
		self.assertEqual(modified_by, ACCOUNTS_USER)
		self.assertIn("doc_update", [call.args[0] for call in publish.call_args_list])
		versions = bot_versions(requisition)
		self.assertEqual(len(versions), 1)
		self.assertEqual(versions[0].owner, ACCOUNTS_USER)

	def test_second_call_returns_already_queued_without_error_or_second_version(self):
		requisition = make_paid_requisition()
		frappe.set_user(ACCOUNTS_USER)
		set_accounts_bot(requisition)
		self.assertEqual(set_accounts_bot(requisition), "already queued")
		frappe.set_user("Administrator")
		self.assertEqual(len(bot_versions(requisition)), 1)

	def test_refuses_when_draft_journal_entry_exists(self):
		requisition = make_paid_requisition()
		make_journal_entry(requisition)
		frappe.set_user(ACCOUNTS_USER)
		self.assertRaises(frappe.ValidationError, set_accounts_bot, requisition)
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Payment Requisition", requisition, "accounts_bot_cf"), 0)

	def test_refuses_user_without_accounts_role(self):
		requisition = make_paid_requisition()
		frappe.set_user(OTHER_USER)
		self.assertRaises(frappe.PermissionError, set_accounts_bot, requisition)
		frappe.set_user("Administrator")
		self.assertEqual(frappe.db.get_value("Payment Requisition", requisition, "accounts_bot_cf"), 0)

	def test_accountant_bot_reads_requisition_and_creates_comment(self):
		grant_accountant_bot_permissions.execute()
		self.assertTrue(frappe.has_permission("Payment Requisition", "read", user=BOT_USER))
		self.assertTrue(frappe.has_permission("Comment", "create", user=BOT_USER))
		self.assertTrue(frappe.has_permission("Comment", "read", user=BOT_USER))
		self.assertFalse(frappe.has_permission("Payment Requisition", "write", user=BOT_USER))

	def queued_requisition(self) -> str:
		requisition = make_paid_requisition()
		frappe.set_user(ACCOUNTS_USER)
		set_accounts_bot(requisition)
		frappe.set_user(BOT_USER)
		return requisition

	def test_status_refuses_user_without_accountant_bot_role(self):
		requisition = self.queued_requisition()
		frappe.set_user(ACCOUNTS_USER)
		self.assertRaises(frappe.PermissionError, set_accounts_bot_status, requisition, "Drafting Journal Entry")

	def test_status_refuses_value_outside_select_options(self):
		requisition = self.queued_requisition()
		self.assertRaises(frappe.ValidationError, set_accounts_bot_status, requisition, "Posted")
		self.assertRaises(frappe.ValidationError, set_accounts_bot_status, requisition, "")
		self.assertEqual(
			frappe.db.get_value("Payment Requisition", requisition, "accounts_bot_status"), "Request Sent"
		)

	def test_status_refuses_moving_back_from_journal_entry_created(self):
		requisition = self.queued_requisition()
		set_accounts_bot_status(requisition, "Journal Entry Created")
		self.assertRaises(
			frappe.ValidationError, set_accounts_bot_status, requisition, "Drafting Journal Entry"
		)
		self.assertEqual(
			frappe.db.get_value("Payment Requisition", requisition, "accounts_bot_status"),
			"Journal Entry Created",
		)

	def test_status_stores_sanitized_note_keeps_modified_and_publishes_to_document_room(self):
		requisition = self.queued_requisition()
		before = frappe.db.get_value("Payment Requisition", requisition, "modified")
		note = '<a href="/app/journal-entry/ACC-JV-1">ACC-JV-1</a><script>alert(1)</script>'

		with patch("frappe.publish_realtime") as publish:
			set_accounts_bot_status(requisition, "Journal Entry Created", note)

		status, stored, modified = frappe.db.get_value(
			"Payment Requisition", requisition, ["accounts_bot_status", "accounts_bot_note", "modified"]
		)
		self.assertEqual(status, "Journal Entry Created")
		self.assertIn('href="/app/journal-entry/ACC-JV-1"', stored)
		self.assertNotIn("<script", stored)
		self.assertEqual(modified, before)
		publish.assert_called_once()
		self.assertEqual(publish.call_args.args[0], "accounts_bot_status")
		self.assertEqual(publish.call_args.args[1]["status"], "Journal Entry Created")
		self.assertEqual(publish.call_args.args[1]["note"], stored)
		self.assertEqual(publish.call_args.kwargs["doctype"], "Payment Requisition")
		self.assertEqual(publish.call_args.kwargs["docname"], requisition)

	def test_retry_resets_stopped_request_bumps_modified_and_notifies(self):
		requisition = self.queued_requisition()
		set_accounts_bot_status(requisition, "Stopped - Needs Review", "Employee account missing")
		before = frappe.db.get_value("Payment Requisition", requisition, "modified")

		frappe.set_user(ACCOUNTS_USER)
		with patch("frappe.publish_realtime") as publish:
			retry_accounts_bot(requisition)

		flag, status, note, modified = frappe.db.get_value(
			"Payment Requisition",
			requisition,
			["accounts_bot_cf", "accounts_bot_status", "accounts_bot_note", "modified"],
		)
		self.assertEqual((flag, status, note), (1, "Request Sent", None))
		self.assertGreater(modified, before)
		self.assertIn("doc_update", [call.args[0] for call in publish.call_args_list])

	def test_retry_refuses_request_that_is_not_stopped(self):
		requisition = self.queued_requisition()
		frappe.set_user(ACCOUNTS_USER)
		self.assertRaises(frappe.ValidationError, retry_accounts_bot, requisition)

	def grant_bot_journal_entry_write(self):
		add_permission("Journal Entry", "Accountant Bot")
		update_permission_property("Journal Entry", "Accountant Bot", 0, "write", 1)
		frappe.clear_cache(doctype="Journal Entry")

	def test_accountant_bot_attaches_pack_to_draft_journal_entry(self):
		self.grant_bot_journal_entry_write()
		requisition = make_requisition()
		journal_entry = make_journal_entry(requisition)

		frappe.set_user(BOT_USER)
		with patch("frappe.get_print", return_value=make_pdf(200)):
			result = attach_pack(requisition, journal_entry)

		self.assertEqual(result["skipped"], [])
		self.assertEqual(
			frappe.db.get_value("File", {"file_url": result["file_url"]}, "attached_to_name"), journal_entry
		)

	def test_accountant_bot_cannot_attach_pack_to_submitted_journal_entry(self):
		self.grant_bot_journal_entry_write()
		requisition = make_requisition()
		journal_entry = make_journal_entry(requisition)
		submit(journal_entry)

		frappe.set_user(BOT_USER)
		with patch("frappe.get_print", return_value=make_pdf(200)):
			self.assertRaises(frappe.PermissionError, attach_pack, requisition, journal_entry)

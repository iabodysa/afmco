# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from afmco.financial_operations.api.accounts_bot import set_accounts_bot
from afmco.financial_operations.test_requisition_pack import make_journal_entry, make_requisition
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
		make_user(BOT_USER, ("Accountant Bot",))
		self.assertTrue(frappe.has_permission("Payment Requisition", "read", user=BOT_USER))
		self.assertTrue(frappe.has_permission("Comment", "create", user=BOT_USER))
		self.assertTrue(frappe.has_permission("Comment", "read", user=BOT_USER))
		self.assertFalse(frappe.has_permission("Payment Requisition", "write", user=BOT_USER))

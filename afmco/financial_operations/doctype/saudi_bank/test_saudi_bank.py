# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase

BANK_USER = "_test_saudi_bank_manager@example.com"


def make_bank(code):
	return frappe.get_doc({"doctype": "Saudi Bank", "name1": f"Bank {code}", "bank_code": code}).insert()


class TestSaudiBankPlainDocument(IntegrationTestCase):
	def setUp(self):
		if not frappe.db.exists("User", BANK_USER):
			frappe.get_doc(
				{
					"doctype": "User",
					"email": BANK_USER,
					"first_name": "Bank Manager",
					"send_welcome_email": 0,
					"roles": [{"role": "System Manager"}],
				}
			).insert()
		self.addCleanup(frappe.set_user, "Administrator")
		frappe.set_user(BANK_USER)

	def test_bank_saves_and_edits_as_draft_without_submit(self):
		bank = make_bank("_T-SB-PLAIN")
		bank.name1 = "Bank Renamed"
		bank.save()

		self.assertEqual(bank.name, "_T-SB-PLAIN")
		self.assertEqual(frappe.db.get_value("Saudi Bank", bank.name, ["docstatus", "name1"]), (0, "Bank Renamed"))
		with self.assertRaises(frappe.PermissionError):
			bank.submit()

	def test_second_bank_with_same_code_is_refused(self):
		make_bank("_T-SB-DUP")

		with self.assertRaises(frappe.DuplicateEntryError):
			make_bank("_T-SB-DUP")

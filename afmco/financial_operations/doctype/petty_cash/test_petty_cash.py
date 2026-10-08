# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase

import frappe
from frappe.utils import getdate


def petty_cash(**values):
	doc = frappe.new_doc("Petty Cash")
	doc.update(values)
	return doc


def petty_cash_form_script():
	with open(
		frappe.get_app_path("afmco", "financial_operations", "doctype", "petty_cash", "petty_cash.js")
	) as script:
		return script.read()


class TestPettyCashDueDate(TestCase):
	def test_new_petty_cash_keeps_the_due_date_the_user_typed(self):
		doc = petty_cash(issue_date="2026-01-01", due_date="2026-01-10")
		doc.validate()
		self.assertEqual(getdate(doc.due_date), getdate("2026-01-10"))

	def test_petty_cash_without_due_date_falls_due_thirty_days_after_issue(self):
		doc = petty_cash(issue_date="2026-01-01")
		doc.validate()
		self.assertEqual(getdate(doc.due_date), getdate("2026-01-31"))

	def test_set_due_date_moves_due_date_to_thirty_days_after_issue(self):
		doc = petty_cash(issue_date="2026-03-01", due_date="2026-01-10")
		doc.set_due_date()
		self.assertEqual(getdate(doc.due_date), getdate("2026-03-31"))

	def test_petty_cash_form_sets_due_date_when_issue_date_changes(self):
		script = petty_cash_form_script()
		self.assertIn("issue_date: function(frm)", script)
		self.assertIn("frm.call('set_due_date')", script)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.client import insert
from frappe.tests import IntegrationTestCase

from afmco.people_and_payroll.api.payroll_entry import VERIFICATION_ERROR_TITLE, log_verification_errors

PAYROLL_USER = "payroll-verifier@afmco.test"
OUTSIDER = "payroll-outsider@afmco.test"


def make_user(email, *roles):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email,
				"send_welcome_email": 0,
			}
		).insert()
	user = frappe.get_doc("User", email)
	user.remove_roles(*[row.role for row in user.roles])
	user.add_roles(*roles)


class TestPayrollEntryVerificationErrorLog(IntegrationTestCase):
	def setUp(self):
		make_user(PAYROLL_USER, "HR Manager")
		make_user(OUTSIDER, "Employee")
		self.message = f"verification failed {frappe.generate_hash(length=10)}"

	def tearDown(self):
		frappe.set_user("Administrator")

	def logged_rows(self):
		return frappe.get_all(
			"Error Log",
			filters={"method": VERIFICATION_ERROR_TITLE, "error": self.message},
			fields=["reference_doctype", "owner"],
		)

	def test_payroll_user_without_system_manager_logs_verification_errors(self):
		frappe.set_user(PAYROLL_USER)
		self.assertNotIn("System Manager", frappe.get_roles())
		log_verification_errors(None, self.message)
		frappe.set_user("Administrator")
		rows = self.logged_rows()
		self.assertEqual(len(rows), 1)
		self.assertEqual(rows[0].reference_doctype, "Payroll Entry")
		self.assertEqual(rows[0].owner, PAYROLL_USER)

	def test_client_insert_of_error_log_is_refused_for_payroll_user(self):
		frappe.set_user(PAYROLL_USER)
		self.assertRaises(
			frappe.PermissionError,
			insert,
			{"doctype": "Error Log", "method": VERIFICATION_ERROR_TITLE, "error": self.message},
		)

	def test_user_without_payroll_entry_read_is_refused(self):
		frappe.set_user(OUTSIDER)
		self.assertRaises(frappe.PermissionError, log_verification_errors, None, self.message)
		frappe.set_user("Administrator")
		self.assertEqual(self.logged_rows(), [])

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils.jinja import get_email_from_template

from afmco.people_and_payroll import payroll

MODULE = "afmco.people_and_payroll.payroll"
ENABLED_MANAGER = "_t-suspension-enabled@example.com"
DISABLED_MANAGER = "_t-suspension-disabled@example.com"


class TestSuspensionRules(TestCase):
	def test_moved_employee_gets_suspended_status(self):
		self.assertEqual(payroll.employee_values()["status"], "Suspended")

	def test_only_employees_actually_moved_are_counted(self):
		outcomes = {"MOVED": True, "KEPT": False}

		def apply(name):
			if name == "BROKEN":
				raise ValueError("boom")
			return outcomes[name]

		outcome = payroll.process_deactivations(["MOVED", "KEPT", "BROKEN"], apply)
		self.assertEqual(outcome["moved"], ["MOVED"])
		self.assertEqual(outcome["updated"], 1)
		self.assertEqual(outcome["errors"], ["BROKEN: boom"])

	def test_no_mail_when_no_employee_moved(self):
		with (
			patch("frappe.sendmail") as sendmail,
			patch("frappe.utils.user.get_users_with_role", return_value=["hr@example.com"]),
			patch(f"{MODULE}.moved_rows", return_value=[]),
			patch("frappe.utils.get_url", return_value="http://site"),
		):
			payroll.notify_hr_managers([])
			sendmail.assert_not_called()
			payroll.notify_hr_managers(["EMP-1"])
			sendmail.assert_called_once()


def make_employee(first_name):
	department = frappe.get_all(
		"Department",
		filters={"is_group": 0, "name": ["not in", payroll.EXCLUDED_DEPARTMENTS]},
		fields=["name", "company"],
		order_by="creation asc",
		limit=1,
	)[0]
	return (
		frappe.get_doc(
			{
				"doctype": "Employee",
				"first_name": first_name,
				"employee_number": first_name,
				"company": department.company,
				"department": department.name,
				"nationality": "Saudi Arabia",
				"gender": "Male",
				"date_of_birth": "1990-01-01",
				"date_of_joining": "2013-01-01",
				"status": "Active",
			}
		)
		.insert()
		.name
	)


def make_hr_manager(email, enabled):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0],
				"enabled": enabled,
				"send_welcome_email": 0,
				"roles": [{"role": "HR Manager"}],
			}
		).insert(ignore_permissions=True)


def enabled_hr_managers():
	return set(
		frappe.db.sql_list(
			"""select distinct u.name from `tabUser` u
			join `tabHas Role` r on r.parent = u.name and r.parenttype = 'User'
			where r.role = 'HR Manager' and u.enabled = 1 and u.name != 'Administrator'"""
		)
	)


def run_job_for(names):
	original = payroll.candidate_filters
	with (
		patch(
			f"{MODULE}.candidate_filters",
			side_effect=lambda window_start: {**original(window_start), "name": ["in", names]},
		),
		patch("frappe.sendmail") as sendmail,
	):
		outcome = payroll.deactivate_employees_without_salary_slip()
	return outcome, sendmail


class TestSuspensionJob(IntegrationTestCase):
	def setUp(self):
		make_hr_manager(ENABLED_MANAGER, 1)
		make_hr_manager(DISABLED_MANAGER, 0)
		self.absent = make_employee("_T-Suspension-Absent")
		self.paid = make_employee("_T-Suspension-Paid")
		slip = frappe.new_doc("Salary Slip")
		slip.update(
			{
				"employee": self.paid,
				"start_date": frappe.utils.get_first_day(frappe.utils.nowdate()),
				"end_date": frappe.utils.get_last_day(frappe.utils.nowdate()),
				"posting_date": frappe.utils.nowdate(),
			}
		)
		slip.set_new_name()
		slip.db_insert()

	def tearDown(self):
		frappe.db.rollback()

	def test_job_suspends_employee_without_slip_and_mails_enabled_hr_managers_once(self):
		outcome, sendmail = run_job_for([self.absent, self.paid])

		self.assertEqual(outcome["moved"], [self.absent])
		self.assertEqual(frappe.db.get_value("Employee", self.absent, "status"), "Suspended")
		self.assertEqual(frappe.db.get_value("Employee", self.paid, "status"), "Active")
		sendmail.assert_called_once()
		recipients = set(sendmail.call_args.kwargs["recipients"])
		self.assertIn(ENABLED_MANAGER, recipients)
		self.assertNotIn(DISABLED_MANAGER, recipients)
		self.assertEqual(recipients, enabled_hr_managers())

		args = sendmail.call_args.kwargs["args"]
		self.assertEqual([row["name"] for row in args["employees"]], [self.absent])
		message, _text = get_email_from_template(sendmail.call_args.kwargs["template"], args)
		employee_name = frappe.db.get_value("Employee", self.absent, "employee_name")
		self.assertIn(self.absent, message)
		self.assertIn(employee_name, message)
		self.assertNotIn(self.paid, message)

	def test_job_sends_no_mail_when_every_candidate_has_a_slip(self):
		outcome, sendmail = run_job_for([self.paid])

		self.assertEqual(outcome["moved"], [])
		sendmail.assert_not_called()

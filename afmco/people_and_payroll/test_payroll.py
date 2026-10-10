# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

import frappe
import jinja2
from frappe.tests import IntegrationTestCase
from frappe.utils.jinja import get_email_from_template

from afmco.people_and_payroll import payroll

MODULE = "afmco.people_and_payroll.payroll"
ENABLED_MANAGER = "_t-hold-enabled@example.com"
DISABLED_MANAGER = "_t-hold-disabled@example.com"
TEMPLATES = Path(payroll.__file__).resolve().parents[1] / "templates"


def render_hold_mail(args):
	environment = jinja2.Environment(loader=jinja2.FileSystemLoader(str(TEMPLATES)))
	environment.globals["_"] = lambda text: text
	return environment.get_template(f"emails/{payroll.HOLD_EMAIL_TEMPLATE}.html").render(args)


class TestHoldRules(TestCase):
	def test_moved_employee_gets_hold_status(self):
		self.assertEqual(payroll.employee_values()["status"], "Hold")

	def test_only_employees_actually_moved_are_counted(self):
		outcomes = {"MOVED": True, "KEPT": False}

		def apply(name):
			if name == "BROKEN":
				raise ValueError("boom")
			return outcomes[name]

		outcome = payroll.process_deactivations(["MOVED", "KEPT", "BROKEN"], apply)
		self.assertEqual(outcome["moved"], ["MOVED"])
		self.assertEqual(outcome["updated"], 1)
		self.assertEqual(outcome["failed"], [{"employee": "BROKEN", "reason": "boom"}])

	def test_no_mail_when_no_employee_moved_and_none_failed(self):
		with (
			patch("frappe.sendmail") as sendmail,
			patch("frappe.utils.user.get_users_with_role", return_value=["hr@example.com"]),
			patch(f"{MODULE}.moved_rows", return_value=[]),
			patch(f"{MODULE}.failed_rows", return_value=[]),
			patch("frappe.utils.get_url", return_value="http://site"),
		):
			payroll.notify_hr_managers([], [])
			sendmail.assert_not_called()
			payroll.notify_hr_managers(["EMP-1"], [])
			sendmail.assert_called_once()
			payroll.notify_hr_managers([], [{"employee": "EMP-2", "reason": "boom"}])
			self.assertEqual(sendmail.call_count, 2)

	def test_failure_reason_in_mail_is_first_line_without_markup(self):
		failed = [{"employee": "EMP-2", "reason": "Row <b>1</b>: Status invalid\nTraceback line"}]
		with patch("frappe.get_all", return_value=[("EMP-2", "Ali Saleh")]):
			rows = payroll.failed_rows(failed)
		self.assertEqual(rows, [{"name": "EMP-2", "employee_name": "Ali Saleh", "reason": "Row 1: Status invalid"}])

	def test_job_mails_failed_employees_and_writes_no_error_log(self):
		def get_all(doctype, **kwargs):
			return ["EMP-2"] if doctype == payroll.EMPLOYEE_DOCTYPE else []

		with (
			patch("frappe.utils.nowdate", return_value="2026-10-01"),
			patch("frappe.get_all", side_effect=get_all),
			patch("frappe.db", MagicMock()),
			patch("frappe.get_doc", side_effect=frappe.ValidationError("Status invalid")),
			patch("frappe.log_error") as log_error,
			patch(f"{MODULE}.notify_hr_managers") as notify,
		):
			outcome = payroll.deactivate_employees_without_salary_slip()

		log_error.assert_not_called()
		failed = [{"employee": "EMP-2", "reason": "Status invalid"}]
		self.assertEqual(outcome["failed"], failed)
		notify.assert_called_once_with([], failed)

	def test_mail_lists_failed_employees_with_reason_apart_from_moved(self):
		args = {
			"employees": [{"name": "EMP-1", "employee_name": "Moved Person", "last_salary_month": "2026-06"}],
			"failed": [{"name": "EMP-2", "employee_name": "Failed Person", "reason": "Status invalid"}],
			"direction": "ltr",
			"site_url": "http://site",
		}
		message = render_hold_mail(args)
		self.assertIn("Could not be put on Hold: 1", message)
		self.assertIn("Failed Person", message)
		self.assertIn("Status invalid", message)
		self.assertLess(message.index("Moved Person"), message.index("Could not be put on Hold"))

		only_moved = render_hold_mail({**args, "failed": []})
		self.assertIn("Moved Person", only_moved)
		self.assertNotIn("Could not be put on Hold", only_moved)


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


class TestHoldJob(IntegrationTestCase):
	def setUp(self):
		make_hr_manager(ENABLED_MANAGER, 1)
		make_hr_manager(DISABLED_MANAGER, 0)
		self.absent = make_employee("_T-Hold-Absent")
		self.paid = make_employee("_T-Hold-Paid")
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

	def test_job_holds_employee_without_slip_and_mails_enabled_hr_managers_once(self):
		outcome, sendmail = run_job_for([self.absent, self.paid])

		self.assertEqual(outcome["moved"], [self.absent])
		self.assertEqual(frappe.db.get_value("Employee", self.absent, "status"), "Hold")
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

	def test_job_mails_employee_it_could_not_hold_and_writes_no_error_log(self):
		error_logs = frappe.db.count("Error Log")
		with patch(f"{MODULE}.employee_values", return_value={"status": "_T-Not-A-Status"}):
			outcome, sendmail = run_job_for([self.absent])

		self.assertEqual(outcome["moved"], [])
		self.assertEqual([row["employee"] for row in outcome["failed"]], [self.absent])
		self.assertEqual(frappe.db.get_value("Employee", self.absent, "status"), "Active")
		self.assertEqual(frappe.db.count("Error Log"), error_logs)
		sendmail.assert_called_once()
		args = sendmail.call_args.kwargs["args"]
		self.assertEqual(args["employees"], [])
		self.assertEqual([row["name"] for row in args["failed"]], [self.absent])
		self.assertNotIn("\n", args["failed"][0]["reason"])

	def test_job_sends_no_mail_when_every_candidate_has_a_slip(self):
		outcome, sendmail = run_job_for([self.paid])

		self.assertEqual(outcome["moved"], [])
		sendmail.assert_not_called()

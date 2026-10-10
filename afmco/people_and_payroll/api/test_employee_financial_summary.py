# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import mock

import frappe
from frappe.tests import IntegrationTestCase

from afmco.people_and_payroll.api.employee_financial_summary import (
	PAGE_SIZE,
	get_employee_financial_summary,
)
from afmco.people_and_payroll.api.test_employee_form_api import make_employee

HR_MANAGER = "efs-hr-manager@afmco.test"
DENIED = "efs-denied@afmco.test"
RESTRICTED_HR_MANAGER = "efs-restricted-hr-manager@afmco.test"
OUTSIDER = "efs-outsider@afmco.test"
DENIED_ROLES = [("HR User",), ("System Manager",), ("Accounts User",), ("Accounts Manager",)]
UNGRANTED_PERMLEVEL = 9
IBAN = "SA0380000000608010167519"


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


def estimate(employee):
	return get_employee_financial_summary(employee)["eos"]["estimate"]


class TestEmployeeFinancialSummary(IntegrationTestCase):
	def setUp(self):
		self.employee = make_employee("_T-EFS-Employee")
		frappe.db.set_value(
			"Employee",
			self.employee,
			{
				"basic_wage": 3000,
				"date_of_joining": "2013-01-01",
				"relieving_date": "2026-01-01",
			},
		)

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_eos_estimate_over_five_years_counts_calendar_span_like_settlement(self):
		self.assertEqual(frappe.utils.date_diff("2026-01-01", "2013-01-01"), 4748)
		result = estimate(self.employee)
		self.assertEqual(result["years"], 13.0)
		self.assertEqual(result["eos_days"], 315.08)
		self.assertEqual(result["per_day"], 100)
		self.assertEqual(result["amount"], 31508.33)

	def test_eos_estimate_up_to_five_years_counts_calendar_span_like_settlement(self):
		frappe.db.set_value("Employee", self.employee, "date_of_joining", "2023-01-01")
		result = estimate(self.employee)
		self.assertEqual(result["service_days"], 1096)
		self.assertEqual(result["eos_days"], 45.04)
		self.assertEqual(result["amount"], 4504.17)

	def test_section_without_doctype_read_is_hidden_and_shown_with_it(self):
		make_user(HR_MANAGER, "HR Manager")
		frappe.set_user(HR_MANAGER)
		frappe.clear_messages()
		self.assertFalse(frappe.has_permission("Payment Requisition", "read"))
		summary = get_employee_financial_summary(self.employee)
		self.assertEqual(summary["requisitions"], {"hidden": True})
		self.assertEqual(summary["employee"]["name"], self.employee)
		self.assertFalse(frappe.message_log)
		frappe.set_user("Administrator")
		make_user(HR_MANAGER, "HR Manager", "Accountant Bot")
		frappe.set_user(HR_MANAGER)
		self.assertIn("account_no", get_employee_financial_summary(self.employee)["requisitions"])

	def test_user_without_summary_read_is_refused(self):
		make_user(OUTSIDER, "Employee")
		frappe.set_user(OUTSIDER)
		self.assertRaises(frappe.PermissionError, get_employee_financial_summary, self.employee)

	def test_roles_without_hr_manager_are_refused(self):
		for roles in DENIED_ROLES:
			with self.subTest(roles=roles):
				frappe.set_user("Administrator")
				make_user(DENIED, *roles)
				frappe.set_user(DENIED)
				self.assertRaises(frappe.PermissionError, get_employee_financial_summary, self.employee)

	def test_hr_manager_receives_summary(self):
		make_user(HR_MANAGER, "HR Manager")
		frappe.set_user(HR_MANAGER)
		summary = get_employee_financial_summary(self.employee)
		self.assertEqual(summary["employee"]["name"], self.employee)
		self.assertEqual(summary["eos"]["estimate"]["amount"], 31508.33)

	def test_hr_manager_without_employee_read_on_target_is_refused(self):
		other = make_employee("_T-EFS-Other")
		make_user(RESTRICTED_HR_MANAGER, "HR Manager")
		frappe.get_doc(
			{"doctype": "User Permission", "user": RESTRICTED_HR_MANAGER, "allow": "Employee", "for_value": other}
		).insert()
		frappe.set_user(RESTRICTED_HR_MANAGER)
		self.assertFalse(frappe.has_permission("Employee", "read", self.employee))
		self.assertRaises(frappe.PermissionError, get_employee_financial_summary, self.employee)

	def test_employee_fields_above_caller_permlevel_are_not_used(self):
		frappe.db.set_value("Employee", self.employee, "iban", IBAN)
		make_user(HR_MANAGER, "HR Manager", "Accountant Bot")
		frappe.set_user(HR_MANAGER)
		meta = frappe.get_meta("Employee")
		self.assertIs(frappe.get_meta("Employee"), meta)
		self.assertNotIn(UNGRANTED_PERMLEVEL, meta.get_permlevel_access("read"))
		with (
			mock.patch.object(meta.get_field("basic_wage"), "permlevel", UNGRANTED_PERMLEVEL),
			mock.patch.object(meta.get_field("iban"), "permlevel", UNGRANTED_PERMLEVEL),
			mock.patch.object(meta.get_field("bank_ac_no"), "permlevel", UNGRANTED_PERMLEVEL),
		):
			summary = get_employee_financial_summary(self.employee)
		self.assertEqual(summary["eos"], {"estimate": None})
		self.assertEqual(summary["requisitions"]["account_no"], "")
		self.assertEqual(summary["employee"]["name"], self.employee)
		unrestricted = get_employee_financial_summary(self.employee)
		self.assertEqual(unrestricted["eos"]["estimate"]["wage"], 3000)
		self.assertEqual(unrestricted["requisitions"]["account_no"], IBAN)

	def test_requisitions_page_by_page_size_with_show_more_offset(self):
		frappe.db.set_value("Employee", self.employee, "iban", IBAN)
		spaced = " ".join(IBAN[i : i + 4] for i in range(0, len(IBAN), 4)).lower()
		for day in range(1, PAGE_SIZE + 3):
			frappe.get_doc(
				{
					"doctype": "Payment Requisition",
					"naming_series": "PR-.YYYY.-",
					"date": f"2026-02-{day:02d}",
					"account_no": spaced,
					"remark": "_T-EFS",
					"amount": 100,
				}
			).insert()
		first = get_employee_financial_summary(self.employee)["requisitions"]
		self.assertEqual(len(first["rows"]), PAGE_SIZE)
		self.assertTrue(first["has_more"])
		more = get_employee_financial_summary(self.employee, "requisitions", PAGE_SIZE)["requisitions"]
		self.assertEqual(len(more["rows"]), 2)
		self.assertFalse(more["has_more"])
		names = [row.name for row in first["rows"] + more["rows"]]
		self.assertEqual(len(set(names)), PAGE_SIZE + 2)
		self.assertEqual(first["rows"][0].date, frappe.utils.getdate("2026-02-07"))

	def test_unpaged_section_refuses_offset_call(self):
		self.assertRaises(
			frappe.ValidationError,
			get_employee_financial_summary,
			self.employee,
			"eos",
			5,
		)

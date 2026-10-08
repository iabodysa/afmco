# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase

from afmco.patches.v16_0.grant_employee_permlevel_one import DOCTYPE, ROLES, execute

PAYROLL_USER = "permlevel-one-payroll@afmco.test"
HR_MANAGER = "permlevel-one-hr-manager@afmco.test"
HR_USER = "permlevel-one-hr-user@afmco.test"


def make_user(email, role):
	if not frappe.db.exists("User", email):
		frappe.get_doc(
			{
				"doctype": "User",
				"email": email,
				"first_name": email.split("@")[0],
				"send_welcome_email": 0,
				"roles": [{"role": role}],
			}
		).insert(ignore_permissions=True)
	return email


def permlevel_access(user, ptype):
	frappe.clear_cache(doctype=DOCTYPE)
	return frappe.get_meta(DOCTYPE).get_permlevel_access(ptype, user=user)


def effective_rows_outside_grant():
	frappe.clear_cache(doctype=DOCTYPE)
	return sorted(
		(p.role, p.permlevel, p.if_owner, p.read, p.write, p.create, p.delete, p.submit, p.cancel)
		for p in frappe.get_meta(DOCTYPE).permissions
		if not (p.role in ROLES and p.permlevel == 1)
	)


class TestGrantEmployeePermlevelOne(IntegrationTestCase):
	def setUp(self):
		make_user(PAYROLL_USER, "Payroll User")
		make_user(HR_MANAGER, "HR Manager")
		make_user(HR_USER, "HR User")

	def test_payroll_user_reads_and_writes_employee_permlevel_one(self):
		execute()
		self.assertIn(1, permlevel_access(PAYROLL_USER, "read"))
		self.assertIn(1, permlevel_access(PAYROLL_USER, "write"))

	def test_hr_manager_reads_and_writes_employee_permlevel_one(self):
		execute()
		self.assertIn(1, permlevel_access(HR_MANAGER, "read"))
		self.assertIn(1, permlevel_access(HR_MANAGER, "write"))

	def test_hr_user_writes_employee_level_zero_but_not_permlevel_one(self):
		execute()
		self.assertIn(0, permlevel_access(HR_USER, "write"))
		self.assertNotIn(1, permlevel_access(HR_USER, "write"))

	def test_employee_role_alone_gets_no_employee_permlevel_one(self):
		execute()
		frappe.clear_cache(doctype=DOCTYPE)
		levels = {p.permlevel for p in frappe.get_meta(DOCTYPE).permissions if p.role == "Employee" and p.read}
		self.assertEqual(levels, {0})

	def test_grant_leaves_every_other_employee_permission_row_unchanged(self):
		before = effective_rows_outside_grant()
		self.assertTrue(before)
		execute()
		self.assertEqual(before, effective_rows_outside_grant())

	def test_grant_run_twice_keeps_one_row_per_role(self):
		execute()
		execute()
		for role in ROLES:
			rows = frappe.get_all(
				"Custom DocPerm",
				filters={"parent": DOCTYPE, "role": role, "permlevel": 1, "if_owner": 0},
				fields=["read", "write", "create", "delete"],
			)
			self.assertEqual(len(rows), 1)
			self.assertEqual(
				(rows[0].read, rows[0].write, rows[0].create, rows[0].delete), (1, 1, 0, 0)
			)

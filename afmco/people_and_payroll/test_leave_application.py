# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase
from unittest.mock import MagicMock, patch

import frappe

from afmco.people_and_payroll.leave_application import AfmcoLeaveApplication

MODULE = "afmco.people_and_payroll.leave_application"


def rejoin(date_of_rejoing, prompted_date):
	leave = frappe._dict(
		employee="EMP-REJOIN",
		docstatus=1,
		status="Approved",
		to_date="2026-10-01",
		date_of_rejoing=date_of_rejoing,
	)
	employee = MagicMock(status="On Leave")

	def get_doc(doctype, *args):
		return employee if doctype == "Employee" else MagicMock()

	with (
		patch(f"{MODULE}.frappe.get_roles", return_value=["HR User"]),
		patch(f"{MODULE}.frappe.get_doc", side_effect=get_doc),
		patch(f"{MODULE}.frappe.msgprint"),
		patch(f"{MODULE}._", side_effect=lambda message, *args, **kwargs: message),
	):
		AfmcoLeaveApplication.rejoin_after_leave(leave, prompted_date)
	return employee


class TestRejoinAfterLeave(TestCase):
	def test_rejoin_writes_leave_application_date_of_rejoing_over_prompted_date(self):
		employee = rejoin("2026-10-02", "2026-10-09")
		self.assertEqual(employee.custom_date_of_rejoining, "2026-10-02")
		self.assertEqual(employee.status, "Active")
		employee.save.assert_called_once()

	def test_rejoin_takes_prompted_date_when_leave_application_has_none(self):
		employee = rejoin(None, "2026-10-02")
		self.assertEqual(employee.custom_date_of_rejoining, "2026-10-02")
		employee.save.assert_called_once()

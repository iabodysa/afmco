# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import frappe
from frappe.tests import IntegrationTestCase

from afmco.people_and_payroll.api.test_employee_form_api import make_employee
from afmco.people_and_payroll.doctype.advance_leave_salary.advance_leave_salary import AdvanceLeaveSalary

IGNORE_TEST_RECORD_DEPENDENCIES = ["Department", "Employee"]

SETTLED_PERIOD = ("2024-10-16", "2025-10-16")
OVERLAPPING_PERIOD = ("2024-10-16", "2025-10-16")
TOUCHING_PERIOD = ("2025-10-16", "2026-10-15")
EARLIER_PERIOD = ("2023-10-16", "2024-10-15")


def period(dates, amount):
	return {"contract_start_date": dates[0], "contract_end_date": dates[1], "status": "unpaid", "amount3": amount}


def settled_advance(employee, state="Approved"):
	return frappe.get_doc(
		{
			"doctype": "Advance Leave Salary",
			"employee": employee,
			"workflow_state": state,
			"cva": [period(SETTLED_PERIOD, 1190)],
		}
	).insert()


def with_periods(doctype, employee, rows, extra):
	unpaid = sum(row["amount3"] for row in rows)
	return frappe.get_doc(
		{
			"doctype": doctype,
			"employee": employee,
			"date_2": "2026-10-15",
			"cva": rows,
			"cva_total": unpaid,
			"amount": unpaid + extra,
		}
	).insert()


class SettledPeriodCase(IntegrationTestCase):
	@classmethod
	def setUpClass(cls):
		for doctype, name, values in (
			("Gender", "Male", {"gender": "Male"}),
			("Warehouse Type", "Transit", {"name": "Transit"}),
			("Holiday List", "Friday", {"holiday_list_name": "Friday", "from_date": "2013-01-01", "to_date": "2030-12-31"}),
			("Workflow State", "Approved", {"workflow_state_name": "Approved"}),
			("Workflow State", "Paid", {"workflow_state_name": "Paid"}),
		):
			if not frappe.db.exists(doctype, name):
				frappe.get_doc({"doctype": doctype, **values}).insert()
		super().setUpClass()

	def assert_periods(self, doc, statuses, cva_total, amount):
		doc.reload()
		self.assertEqual([row.status for row in doc.cva], statuses)
		self.assertEqual(doc.cva_total, cva_total)
		self.assertEqual(doc.amount, amount)


class TestAdvanceLeaveSalarySettledPeriods(SettledPeriodCase):
	doctype = "Advance Leave Salary"

	def test_period_overlapping_approved_advance_is_saved_paid_and_leaves_totals(self):
		employee = make_employee("_T-ALS-Overlap")
		settled_advance(employee)

		doc = with_periods(self.doctype, employee, [period(EARLIER_PERIOD, 1000), period(OVERLAPPING_PERIOD, 1190)], 600)

		self.assert_periods(doc, ["unpaid", "Paid"], 1000, 1600)

	def test_period_overlapping_paid_advance_is_saved_paid(self):
		employee = make_employee("_T-ALS-Overlap-Paid")
		settled_advance(employee, state="Paid")

		doc = with_periods(self.doctype, employee, [period(OVERLAPPING_PERIOD, 1190)], 0)

		self.assert_periods(doc, ["Paid"], 0, 0)

	def test_period_touching_approved_advance_on_boundary_day_stays_unpaid(self):
		employee = make_employee("_T-ALS-Touch")
		settled_advance(employee)

		doc = with_periods(self.doctype, employee, [period(TOUCHING_PERIOD, 1190)], 600)

		self.assert_periods(doc, ["unpaid"], 1190, 1790)


SETTLED_FILTERS = {"employee": "EMP-1", "name": ["!=", "NEW-1"], "workflow_state": ["in", ("Approved", "Paid")]}
PERIOD_FILTERS = {"parenttype": "Advance Leave Salary", "parentfield": "cva", "parent": ["in", ["VA-OLD"]]}


def fake_get_all(doctype, filters=None, **kwargs):
	if doctype == "Advance Leave Salary":
		return ["VA-OLD"] if filters == SETTLED_FILTERS else []
	if doctype == "Contract Vacation Allowance":
		if filters != PERIOD_FILTERS:
			return []
		return [frappe._dict(contract_start_date=SETTLED_PERIOD[0], contract_end_date=SETTLED_PERIOD[1])]
	return []


def unsaved(doctype, rows, extra):
	cva = [frappe._dict(row) for row in rows]
	unpaid = sum(row.amount3 for row in cva)
	return SimpleNamespace(doctype=doctype, name="NEW-1", employee="EMP-1", cva=cva, cva_total=unpaid, amount=unpaid + extra)


class SettledPeriodValidation(TestCase):
	def validated(self, controller, rows, extra):
		doc = unsaved(self.doctype, rows, extra)
		with patch("frappe.get_all", side_effect=fake_get_all):
			controller.validate(doc)
		return [row.status for row in doc.cva], doc.cva_total, doc.amount


class TestAdvanceLeaveSalarySettledPeriodValidation(SettledPeriodValidation):
	doctype = "Advance Leave Salary"

	def test_validate_marks_period_overlapping_settled_advance_paid_and_leaves_totals(self):
		result = self.validated(AdvanceLeaveSalary, [period(EARLIER_PERIOD, 1000), period(OVERLAPPING_PERIOD, 1190.5)], 600)
		self.assertEqual(result, (["unpaid", "Paid"], 1000, 1600))

	def test_validate_leaves_period_touching_settled_advance_on_boundary_day_unpaid(self):
		result = self.validated(AdvanceLeaveSalary, [period(TOUCHING_PERIOD, 1190.5)], 600)
		self.assertEqual(result, (["unpaid"], 1190.5, 1790.5))

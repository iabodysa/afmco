# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase
from unittest.mock import patch

import frappe

from afmco.people_and_payroll.doctype.employee_salary_adjustment.employee_salary_adjustment import (
	EmployeeSalaryAdjustment,
)


def adjustment_on(today):
	doc = frappe._dict(
		grade=1,
		date_of_joining="2023-03-01",
		increase_rate=0,
		last_month_salary=1000,
		last_month_salary_last_year=None,
		adjust_for_previous_salary_diff=0,
	)
	with patch("frappe.utils.nowdate", return_value=today):
		EmployeeSalaryAdjustment.calculate_salary_increase(doc)
	return doc


class TestYearsOfService(TestCase):
	def test_year_counts_only_from_the_joining_anniversary_across_feb_29(self):
		self.assertEqual(adjustment_on("2024-02-29").years_of_service, 0)
		self.assertEqual(adjustment_on("2024-03-01").years_of_service, 1)
		self.assertEqual(adjustment_on("2024-03-01").calculated_increase, 10)

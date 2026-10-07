# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase

from afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement import (
	employee_values,
	feedback_for,
)

SETTLEMENT = {
	"name": "Exit-2026-00001",
	"employee_name": "Test Employee",
	"employee": "EMP-0001",
	"total_salary": 1000.0,
	"salary_per_day": 33.33,
	"ticket_allowance": None,
	"total_eos": 1711.0,
	"deductions": 0.0,
	"cva_total": 994.0,
	"amount": 3305.0,
	"duration_of_service": "1249.00",
	"end_of_service_reason": "1-End of term or mutual agreement",
	"alternative_reward": None,
	"date_2": "2026-01-31",
	"creation": "2026-01-01 10:00:00",
}


class TestEndOfServiceFeedback(TestCase):
	def test_feedback_prints_service_duration_in_years_months_days(self):
		self.assertIn("- Service Duration: 3 Year(s), 5 Month(s), 4 Day(s)", feedback_for(SETTLEMENT))

	def test_feedback_prints_unset_amounts_empty(self):
		text = feedback_for(SETTLEMENT)
		self.assertIn("- Ticket Allowance: \n", text)
		for missing in ("None", "undefined", "NaN"):
			self.assertNotIn(missing, text)

	def test_reason_for_leaving_carries_settlement_name_and_reason(self):
		self.assertEqual(
			employee_values(SETTLEMENT)["reason_for_leaving"],
			"Exit-2026-00001 | 1-End of term or mutual agreement",
		)

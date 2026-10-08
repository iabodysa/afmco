# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from datetime import date
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement import (
	EndofServiceSettlement,
	employee_values,
	feedback_for,
	pending_filters,
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

	def test_relieving_date_is_day_after_last_working_day(self):
		self.assertEqual(employee_values(SETTLEMENT)["relieving_date"], date(2026, 2, 1))

	def test_resignation_letter_date_is_settlement_creation_date(self):
		self.assertEqual(employee_values(SETTLEMENT)["resignation_letter_date"], date(2026, 1, 1))

	def test_pending_filters_select_submitted_settlements_not_yet_updated(self):
		self.assertEqual(pending_filters(), {"docstatus": 1, "employee_status": ["!=", "Updated"]})


RELIEVE = "afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement.relieve_employee"


def settlement_in(state, last_working_day="2026-01-31"):
	return SimpleNamespace(
		workflow_state=state,
		employee_status="Not updated",
		date_2=last_working_day,
		has_value_changed=lambda field: field == "workflow_state",
	)


class TestEndOfServiceRelievingOnPayment(TestCase):
	def submit_paid_on(self, today, last_working_day="2026-01-31"):
		document = settlement_in("Paid", last_working_day)
		with patch("frappe.utils.nowdate", return_value=today), patch(RELIEVE) as relieve:
			EndofServiceSettlement.on_submit(document)
		return document, relieve

	def test_submitting_paid_after_last_working_day_relieves_employee(self):
		document, relieve = self.submit_paid_on("2026-03-01")
		relieve.assert_called_once_with(document)

	def test_submitting_paid_on_relieving_date_relieves_employee(self):
		document, relieve = self.submit_paid_on("2026-02-01")
		relieve.assert_called_once_with(document)

	def test_submitting_paid_on_last_working_day_leaves_employee_to_daily_job(self):
		_document, relieve = self.submit_paid_on("2026-01-31")
		relieve.assert_not_called()

	def test_entering_approved_leaves_employee_untouched(self):
		with patch("frappe.utils.nowdate", return_value="2026-03-01"), patch(RELIEVE) as relieve:
			EndofServiceSettlement.on_update(settlement_in("Approved"))
		relieve.assert_not_called()

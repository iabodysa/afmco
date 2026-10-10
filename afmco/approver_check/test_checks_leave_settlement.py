# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime, nowdate

from afmco.approver_check.test_checks_payment import (
	ALS,
	EOS,
	OTHER_USER,
	attach,
	employee,
	make_leave,
	make_settlement,
	pdf_bytes,
	status,
	verdict,
	version,
)
from afmco.approver_check.test_iban import broken_checksum, iban
from afmco.people_and_payroll.api.test_employee_financial_summary import make_user

JOINED = "2013-01-01"
ARTICLE_80 = "3-Termination by the employer under Article 80"
FORCE_MAJEURE = "4-Termination due to force majeure"
END_OF_TERM = "1-End of term or mutual agreement"
RESIGNATION = "8-Resignation"


def row(start: str, end: str, amount3: float, vad: str = "21", state: str = "unpaid") -> dict:
	return {"contract_start_date": start, "contract_end_date": end, "status": state, "vad": vad, "amount3": amount3}


def record(doctype: str, staff: str, **values):
	base = {
		"doctype": doctype,
		"name": f"_T-AC-{frappe.generate_hash(length=8)}",
		"owner": "Guest",
		"creation": now_datetime(),
		"employee": staff,
		"account_no": frappe.db.get_value("Employee", staff, "bank_ac_no"),
		"total_salary": 3000,
		"date_1": JOINED,
		"workflow_state": "Waiting Manager Approval",
	}
	base.update(values)
	return frappe.get_doc(base)


def staff_member(**values) -> str:
	return employee(basic_wage=3000, **values)


class TestLeaveAndSettlementAccounting(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_stored_amount_must_match_a_fresh_calculation(self):
		leave = make_leave(staff_member(), state="Waiting Manager Approval", total_salary=3000, date_1=JOINED, date_2="2024-12-31", rows=[row("2024-01-01", "2024-12-30", 2100)])
		self.assertEqual(status(leave, "ALS-ACC-01"), "pass")
		frappe.db.set_value(ALS, leave.name, "amount", leave.amount + 500, update_modified=False)
		self.assertEqual(status(frappe.get_doc(ALS, leave.name), "ALS-ACC-01"), "warn")
		settlement = make_settlement(staff_member(), state="Waiting Manager Approval", total_salary=3000, date_1=JOINED, date_2="2024-12-31", end_of_service_reason=END_OF_TERM)
		self.assertEqual(status(settlement, "EOS-ACC-01"), "pass")
		frappe.db.set_value(EOS, settlement.name, "amount", settlement.amount + 500, update_modified=False)
		self.assertEqual(status(frappe.get_doc(EOS, settlement.name), "EOS-ACC-01"), "warn")

	def test_salary_must_match_the_employee_basic_wage_and_shows_the_actual_wage(self):
		staff = staff_member()
		for doctype, check_id in ((ALS, "ALS-ACC-02"), (EOS, "EOS-ACC-02")):
			item = verdict(record(doctype, staff, total_salary=3000), check_id)
			self.assertEqual(item["status"], "pass")
			self.assertIn("Article 2", str(item["evidence"]))
			self.assertEqual(status(record(doctype, staff, total_salary=3500), check_id), "warn")

	def test_joining_date_must_match_the_employee(self):
		staff = staff_member()
		for doctype, check_id in ((ALS, "ALS-ACC-03"), (EOS, "EOS-ACC-03")):
			self.assertEqual(status(record(doctype, staff, date_1=JOINED), check_id), "pass")
			self.assertEqual(status(record(doctype, staff, date_1="2014-01-01"), check_id), "warn")

	def test_hand_edited_period_amount_differs_from_the_formula(self):
		staff = staff_member()
		for doctype, check_id in ((ALS, "ALS-ACC-04"), (EOS, "EOS-ACC-04")):
			self.assertEqual(status(record(doctype, staff, cva=[row("2024-01-01", "2024-12-30", 2100)]), check_id), "pass")
			item = verdict(record(doctype, staff, cva=[row("2024-01-01", "2024-12-30", 2600)]), check_id)
			self.assertEqual((item["status"], item["severity"]), ("warn", "info"))


class TestLeaveAndSettlementPolicy(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_period_counted_in_another_approved_record_fails_and_blocks_beyond_a_month(self):
		staff = staff_member()
		make_leave(staff, state="Approved", rows=[row("2022-01-01", "2022-12-31", 2100)])
		long_clash = verdict(record(ALS, staff, cva=[row("2022-03-01", "2023-02-28", 2100)]), "ALS-POL-01")
		self.assertEqual((long_clash["status"], long_clash["severity"]), ("fail", "block"))
		short_clash = verdict(record(EOS, staff, cva=[row("2022-12-20", "2023-12-19", 2100)]), "EOS-POL-05")
		self.assertEqual((short_clash["status"], short_clash["severity"]), ("fail", "warn"))
		self.assertEqual(status(record(ALS, staff, cva=[row("2023-01-01", "2023-12-31", 2100)]), "ALS-POL-01"), "pass")

	def test_period_counted_in_a_rejected_record_is_ignored(self):
		staff = staff_member()
		make_leave(staff, state="Rejected", rows=[row("2022-01-01", "2022-12-31", 2100)])
		self.assertEqual(status(record(ALS, staff, cva=[row("2022-03-01", "2023-02-28", 2100)]), "ALS-POL-01"), "pass")

	def test_period_counted_in_a_cancelled_record_still_marked_paid_is_ignored(self):
		staff = staff_member()
		settlement = make_settlement(staff, state="Paid", rows=[row("2022-01-01", "2022-12-31", 2100)])
		frappe.db.set_value(EOS, settlement.name, "docstatus", 2, update_modified=False)
		self.assertEqual(status(record(ALS, staff, cva=[row("2022-03-01", "2023-02-28", 2100)]), "ALS-POL-01"), "pass")
		self.assertEqual(status(record(EOS, staff, cva=[row("2022-03-01", "2023-02-28", 2100)]), "EOS-POL-05"), "pass")

	def test_leave_days_below_twenty_one_warn(self):
		staff = staff_member()
		self.assertEqual(status(record(ALS, staff, cva=[row("2024-01-01", "2024-12-30", 2000, vad="20")]), "ALS-POL-02"), "warn")
		self.assertEqual(status(record(ALS, staff, cva=[row("2024-01-01", "2024-12-30", 2100)]), "ALS-POL-02"), "pass")

	def test_period_before_joining_warns(self):
		staff = staff_member()
		self.assertEqual(status(record(ALS, staff, cva=[row("2012-01-01", "2012-12-30", 2100)]), "ALS-POL-03"), "warn")
		self.assertEqual(status(record(ALS, staff, cva=[row("2014-01-01", "2014-12-30", 2100)]), "ALS-POL-03"), "pass")

	def test_advance_more_than_ninety_days_ahead_warns(self):
		staff = staff_member()
		far = add_days(nowdate(), 200)
		near = add_days(nowdate(), 30)
		self.assertEqual(status(record(ALS, staff, cva=[row(add_days(far, -364), far, 2100)]), "ALS-POL-04"), "warn")
		self.assertEqual(status(record(ALS, staff, cva=[row(add_days(near, -364), near, 2100)]), "ALS-POL-04"), "pass")

	def test_leave_salary_for_an_employee_who_left_warns(self):
		self.assertEqual(status(record(ALS, staff_member(status="Left", relieving_date="2025-01-01")), "ALS-POL-05"), "warn")
		self.assertEqual(status(record(ALS, staff_member()), "ALS-POL-05"), "pass")

	def test_second_leave_salary_awaiting_approval_warns_except_ticket_only(self):
		staff = staff_member()
		make_leave(staff, state="Approved")
		self.assertEqual(status(record(ALS, staff), "ALS-POL-06"), "pass")
		make_leave(staff, state="Waiting Accountant Approval", rows=[row("2024-01-01", "2024-12-30", 2100)])
		self.assertEqual(status(record(ALS, staff), "ALS-POL-06"), "warn")
		self.assertEqual(status(record(ALS, staff, cva_total=0, number_of_tickets=1), "ALS-POL-06"), "na")

	def test_settlement_reason_must_be_coded(self):
		staff = staff_member()
		self.assertEqual(status(record(EOS, staff, end_of_service_reason=END_OF_TERM), "EOS-POL-01"), "pass")
		self.assertEqual(status(record(EOS, staff, end_of_service_reason="Select"), "EOS-POL-01"), "fail")

	def test_zero_and_full_award_reasons_need_a_file(self):
		staff = staff_member()
		for reason, check_id in ((ARTICLE_80, "EOS-POL-02"), (FORCE_MAJEURE, "EOS-POL-03")):
			bare = make_settlement(staff_member(), end_of_service_reason=reason)
			self.assertEqual(status(bare, check_id), "warn")
			attach(EOS, bare.name, "record.pdf", pdf_bytes())
			self.assertEqual(status(bare, check_id), "pass")
			self.assertEqual(status(record(EOS, staff, end_of_service_reason=END_OF_TERM), check_id), "na")

	def test_deductions_above_half_of_final_dues_warn(self):
		staff = staff_member()
		self.assertEqual(status(record(EOS, staff, total_eos=1000, deductions=600), "EOS-POL-04"), "warn")
		self.assertEqual(status(record(EOS, staff, total_eos=1000, deductions=100), "EOS-POL-04"), "pass")

	def test_unpaid_settlement_past_the_article_88_deadline_is_flagged(self):
		staff = staff_member()
		self.assertEqual(status(record(EOS, staff, end_of_service_reason=RESIGNATION, date_2=add_days(nowdate(), -10)), "EOS-POL-06"), "pass")
		self.assertEqual(status(record(EOS, staff, end_of_service_reason=RESIGNATION, date_2=add_days(nowdate(), -20)), "EOS-POL-06"), "warn")
		self.assertEqual(status(record(EOS, staff, end_of_service_reason=END_OF_TERM, date_2=add_days(nowdate(), -10)), "EOS-POL-06"), "warn")

	def test_article_80_row_states_the_article_84_and_85_award(self):
		item = verdict(make_settlement(staff_member(), end_of_service_reason=ARTICLE_80), "EOS-POL-02")
		self.assertIn("Articles 84 and 85", item["detail"])
		self.assertNotIn("pays no award", item["detail"])
		law = " ".join(entry["value"] for entry in item["evidence"])
		self.assertIn("Article 84: half a month's wage for each of the first five years", law)
		self.assertIn("Article 85: a worker who resigns receives one third", law)

	def test_article_88_row_states_one_week_for_employer_and_two_weeks_for_worker(self):
		staff = staff_member()
		for reason, days, state in ((END_OF_TERM, 10, "warn"), (RESIGNATION, 10, "pass")):
			item = verdict(record(EOS, staff, end_of_service_reason=reason, date_2=add_days(nowdate(), -days)), "EOS-POL-06")
			self.assertEqual(item["status"], state)
			self.assertIn("one week when the employer ends the contract and two weeks when the worker ends it", item["detail"])

	def test_approver_who_created_the_record_is_warned(self):
		staff = staff_member()
		for doctype, check_id in ((ALS, "ALS-POL-07"), (EOS, "EOS-POL-07")):
			self.assertEqual(status(record(doctype, staff, owner="Administrator"), check_id), "warn")
			self.assertEqual(status(record(doctype, staff, owner="Guest"), check_id), "pass")


class TestLeaveAndSettlementAttachmentsAndAccounts(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_missing_file_warns_on_settlement_and_informs_on_leave_salary(self):
		leave = make_leave(staff_member(), state="Waiting Manager Approval")
		item = verdict(leave, "ALS-ATT-01")
		self.assertEqual((item["status"], item["severity"]), ("warn", "info"))
		attach(ALS, leave.name, "form.pdf", pdf_bytes())
		self.assertEqual(status(leave, "ALS-ATT-01"), "pass")
		settlement = make_settlement(staff_member())
		self.assertEqual(verdict(settlement, "EOS-ATT-01")["severity"], "warn")
		self.assertEqual(status(settlement, "EOS-ATT-01"), "warn")

	def test_iban_checksum_fails_and_cash_settlement_skips_the_bank_checks(self):
		staff = staff_member()
		for doctype, check_id in ((ALS, "ALS-BEN-01"), (EOS, "EOS-BEN-01")):
			self.assertEqual(status(record(doctype, staff, account_no=broken_checksum(iban())), check_id), "fail")
			self.assertEqual(status(record(doctype, staff), check_id), "pass")
		self.assertEqual(status(record(EOS, staff, check3=1), "EOS-BEN-01"), "na")
		self.assertEqual(status(record(EOS, staff, check3=1), "EOS-BEN-02"), "na")

	def test_account_must_match_the_employee(self):
		staff = staff_member()
		for doctype, check_id in ((ALS, "ALS-BEN-02"), (EOS, "EOS-BEN-02")):
			self.assertEqual(status(record(doctype, staff), check_id), "pass")
			self.assertEqual(status(record(doctype, staff, account_no=iban()), check_id), "warn")

	def test_recent_bank_change_warns_from_the_last_working_day(self):
		staff = staff_member()
		self.assertEqual(status(record(ALS, staff), "ALS-BEN-03"), "pass")
		version("Employee", staff, [["bank_ac_no", iban(), iban()]], owner=OTHER_USER, days_ago=100)
		self.assertEqual(status(record(EOS, staff, date_2=add_days(nowdate(), -110)), "EOS-BEN-03"), "warn")
		self.assertEqual(status(record(EOS, staff, date_2=add_days(nowdate(), -10)), "EOS-BEN-03"), "pass")
		self.assertEqual(status(record(ALS, staff), "ALS-BEN-03"), "pass")

	def test_cash_settlement_set_by_the_approver_fails_and_otherwise_warns(self):
		make_user(OTHER_USER, "System Manager")
		staff = staff_member()
		self.assertEqual(status(record(EOS, staff, check3=0), "EOS-BEN-04"), "na")
		mine = record(EOS, staff, check3=1, owner="Guest")
		version(EOS, mine.name, [["check3", 0, 1]], owner="Administrator")
		self.assertEqual(status(mine, "EOS-BEN-04"), "fail")
		theirs = record(EOS, staff, check3=1, owner="Guest")
		version(EOS, theirs.name, [["check3", 0, 1]], owner=OTHER_USER)
		self.assertEqual(status(theirs, "EOS-BEN-04"), "warn")

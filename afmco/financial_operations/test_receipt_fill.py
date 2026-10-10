# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, today

from afmco.financial_operations.api.accounts_bot import fill_payment_fields, request_receipt_read
from afmco.financial_operations.test_accounts_bot import make_user
from afmco.financial_operations.test_requisition_pack import attach_file, make_pdf, make_requisition

BOT_USER = "accounts-bot@example.com"
AUDITOR_USER = "receipt-auditor@example.com"
OUTSIDER_USER = "receipt-outsider@example.com"
RECEIPT_FIELDS = {"bank_payment_date", "bank_account", "paid_amount_cf", "beneficiary_employee_cf", "bank_reference_cf"}
APPROVED_FIELDS = ("amount", "account_no", "beneficiary_name", "payment_type", "remark", "workflow_state", "docstatus")


def make_upload_requisition() -> str:
	requisition = make_requisition()
	frappe.db.set_value("Payment Requisition", requisition, "workflow_state", "Document Upload", update_modified=False)
	return requisition


def company_bank(own: bool) -> str:
	company = frappe.db.get_single_value("Global Defaults", "default_company")
	return frappe.db.get_value(
		"Account",
		{"account_type": "Bank", "is_group": 0, "disabled": 0, "company": company if own else ["!=", company]},
	)


def receipt_values() -> dict:
	return {
		"bank_payment_date": today(),
		"bank_account": company_bank(own=True),
		"paid_amount_cf": 100.5,
		"beneficiary_employee_cf": frappe.db.get_value("Employee", {"status": "Active"}),
		"bank_reference_cf": "FT2610100001",
	}


def fill_as(user: str, requisition: str, values: dict) -> dict:
	frappe.set_user(user)
	try:
		return fill_payment_fields(requisition, json.dumps(values))
	finally:
		frappe.set_user("Administrator")


def approved_values(requisition: str) -> dict:
	return frappe.db.get_value("Payment Requisition", requisition, APPROVED_FIELDS, as_dict=True)


def changed_fields(requisition: str) -> set[str]:
	return {
		row[0]
		for data in frappe.get_all(
			"Version", filters={"ref_doctype": "Payment Requisition", "docname": requisition}, pluck="data"
		)
		for row in json.loads(data).get("changed", [])
	}


class TestReceiptFill(IntegrationTestCase):
	def setUp(self):
		make_user(BOT_USER, ("Accountant Bot",))
		make_user(AUDITOR_USER, ("Auditor",))
		make_user(OUTSIDER_USER, ("System Manager",))

	def tearDown(self):
		frappe.set_user("Administrator")

	def test_user_without_accountant_bot_role_is_refused_and_nothing_is_written(self):
		requisition = make_upload_requisition()
		with self.assertRaises(frappe.PermissionError):
			fill_as(OUTSIDER_USER, requisition, {"bank_payment_date": today()})
		self.assertIsNone(frappe.db.get_value("Payment Requisition", requisition, "bank_payment_date"))

	def test_requisition_outside_document_upload_is_refused_and_nothing_is_written(self):
		requisition = make_requisition()
		frappe.db.set_value("Payment Requisition", requisition, "workflow_state", "Paid", update_modified=False)
		with self.assertRaises(frappe.ValidationError):
			fill_as(BOT_USER, requisition, {"bank_payment_date": today()})
		self.assertIsNone(frappe.db.get_value("Payment Requisition", requisition, "bank_payment_date"))

	def test_key_outside_the_five_receipt_fields_refuses_the_whole_call(self):
		requisition = make_upload_requisition()
		with self.assertRaises(frappe.ValidationError):
			fill_as(BOT_USER, requisition, {"bank_payment_date": today(), "amount": 5})
		self.assertIsNone(frappe.db.get_value("Payment Requisition", requisition, "bank_payment_date"))
		self.assertEqual(frappe.db.get_value("Payment Requisition", requisition, "amount"), 100)

	def test_field_a_person_already_filled_is_skipped_and_keeps_its_value(self):
		requisition = make_upload_requisition()
		typed = add_days(today(), -1)
		frappe.db.set_value("Payment Requisition", requisition, "date", typed, update_modified=False)
		frappe.db.set_value("Payment Requisition", requisition, "bank_payment_date", typed, update_modified=False)
		result = fill_as(BOT_USER, requisition, {"bank_payment_date": today(), "bank_account": company_bank(own=True)})
		self.assertEqual(result["written"], ["bank_account"])
		self.assertEqual(result["skipped"], [{"field": "bank_payment_date", "reason": "not empty"}])
		self.assertEqual(frappe.db.get_value("Payment Requisition", requisition, "bank_payment_date"), getdate(typed))

	def test_each_receipt_field_is_written_with_one_comment_and_versioned_alone(self):
		requisition = make_upload_requisition()
		values = receipt_values()
		result = fill_as(BOT_USER, requisition, values)
		self.assertEqual(set(result["written"]), RECEIPT_FIELDS)
		stored = frappe.db.get_value("Payment Requisition", requisition, list(RECEIPT_FIELDS), as_dict=True)
		self.assertEqual(stored.bank_payment_date, getdate(values["bank_payment_date"]))
		self.assertEqual(stored.bank_account, values["bank_account"])
		self.assertEqual(stored.paid_amount_cf, 100.5)
		self.assertEqual(stored.beneficiary_employee_cf, values["beneficiary_employee_cf"])
		self.assertEqual(stored.bank_reference_cf, "FT2610100001")
		comments = frappe.get_all(
			"Comment",
			filters={"reference_doctype": "Payment Requisition", "reference_name": requisition, "comment_type": "Comment"},
			fields=["content", "comment_email"],
		)
		self.assertEqual(len(comments), 1)
		self.assertEqual(comments[0].comment_email, BOT_USER)
		self.assertIn("FT2610100001", comments[0].content)
		self.assertEqual(changed_fields(requisition), RECEIPT_FIELDS)

	def test_bank_account_of_another_company_is_refused(self):
		requisition = make_upload_requisition()
		foreign = company_bank(own=False)
		self.assertTrue(foreign)
		with self.assertRaises(frappe.ValidationError):
			fill_as(BOT_USER, requisition, {"bank_account": foreign})
		self.assertIsNone(frappe.db.get_value("Payment Requisition", requisition, "bank_account"))

	def test_invalid_values_are_refused_before_any_write(self):
		requisition = make_upload_requisition()
		for values in (
			{"bank_payment_date": add_days(today(), 1)},
			{"bank_payment_date": "not a date"},
			{"bank_account": 7},
			{"paid_amount_cf": 0},
			{"beneficiary_employee_cf": "EMP-NONE"},
			{"bank_reference_cf": " "},
			{"bank_payment_date": today(), "paid_amount_cf": -1},
		):
			with self.subTest(values=values), self.assertRaises(frappe.ValidationError):
				fill_as(BOT_USER, requisition, values)
		self.assertIsNone(frappe.db.get_value("Payment Requisition", requisition, "bank_payment_date"))

	def test_approved_fields_stay_untouched_and_version_shows_only_receipt_fields(self):
		requisition = make_upload_requisition()
		before = approved_values(requisition)
		fill_as(BOT_USER, requisition, {"bank_payment_date": today(), "bank_account": company_bank(own=True)})
		self.assertEqual(approved_values(requisition), before)
		self.assertEqual(changed_fields(requisition), {"bank_payment_date", "bank_account"})

	def test_read_receipt_sets_queue_flag_only_with_an_attachment_at_document_upload(self):
		requisition = make_upload_requisition()
		frappe.set_user(AUDITOR_USER)
		with self.assertRaises(frappe.ValidationError):
			request_receipt_read(requisition)
		frappe.set_user("Administrator")
		attach_file(requisition, "receipt.pdf", make_pdf(595))
		before = approved_values(requisition)
		frappe.set_user(AUDITOR_USER)
		self.assertEqual(request_receipt_read(requisition), "queued")
		self.assertEqual(request_receipt_read(requisition), "already queued")
		frappe.set_user("Administrator")
		flag, status = frappe.db.get_value(
			"Payment Requisition", requisition, ["accounts_bot_read_receipt_cf", "accounts_bot_status"]
		)
		self.assertEqual((flag, status), (1, "Request Sent"))
		self.assertEqual(approved_values(requisition), before)
		self.assertIsNone(frappe.db.get_value("Payment Requisition", requisition, "bank_payment_date"))

	def test_read_receipt_is_refused_for_other_roles_and_other_states(self):
		requisition = make_upload_requisition()
		attach_file(requisition, "receipt.pdf", make_pdf(595))
		frappe.set_user(OUTSIDER_USER)
		with self.assertRaises(frappe.PermissionError):
			request_receipt_read(requisition)
		frappe.set_user("Administrator")
		frappe.db.set_value("Payment Requisition", requisition, "workflow_state", "Paid", update_modified=False)
		frappe.set_user(AUDITOR_USER)
		with self.assertRaises(frappe.ValidationError):
			request_receipt_read(requisition)

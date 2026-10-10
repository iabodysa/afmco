# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import io
import json

import frappe
import pikepdf
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, now_datetime, nowdate
from pypdf import PdfWriter

from afmco.approver_check import engine
from afmco.approver_check.registry import REGISTRY
from afmco.approver_check.test_iban import broken_checksum, iban
from afmco.people_and_payroll.api.test_employee_financial_summary import make_employee, make_user

PR = "Payment Requisition"
ALS = "Advance Leave Salary"
EOS = "End of Service Settlement"
OTHER_USER = "approver-check-other@afmco.test"
PLAIN_READER = "approver-check-plain-reader@afmco.test"


def check(check_id: str):
	return next(c for checks in REGISTRY.values() for c in checks if c.id == check_id)


def verdict(doc, check_id: str) -> dict:
	return engine.run(doc, [check(check_id)])["items"][0]


def status(doc, check_id: str) -> str:
	return verdict(doc, check_id)["status"]


def pr(**values):
	base = {
		"doctype": PR,
		"name": f"_T-AC-{frappe.generate_hash(length=8)}",
		"owner": "Administrator",
		"creation": now_datetime(),
		"date": nowdate(),
		"amount": 100,
		"account_no": iban(),
		"beneficiary_name": "Test Beneficiary",
		"remark": "Payment for the approver check test",
		"payment_type": "Other Payment",
		"mode_of_payment": "Local Bank Transfer",
		"workflow_state": "Waiting P.M Approval",
	}
	base.update(values)
	return frappe.get_doc(base)


def make_pr(state: str | None = "Waiting P.M Approval", **values):
	doc = pr(**values)
	for key in ("name", "owner", "creation", "workflow_state"):
		doc.set(key, None)
	doc.insert()
	if state:
		frappe.db.set_value(PR, doc.name, "workflow_state", state, update_modified=False)
	return frappe.get_doc(PR, doc.name)


def employee(bank_ac_no: str | None = None, **values) -> str:
	name = make_employee(f"_T-AC-{frappe.generate_hash(length=6)}")
	frappe.db.set_value("Employee", name, {"bank_ac_no": bank_ac_no or iban(), **values})
	return name


def make_leave(employee_name: str, state: str = "Approved", rows=(), **values):
	doc = frappe.get_doc({"doctype": ALS, "employee": employee_name, "cva": list(rows), **values}).insert()
	frappe.db.set_value(ALS, doc.name, "workflow_state", state, update_modified=False)
	return frappe.get_doc(ALS, doc.name)


def make_settlement(employee_name: str, state: str = "Approved", rows=(), **values):
	doc = frappe.get_doc({"doctype": EOS, "employee": employee_name, "cva": list(rows), **values}).insert()
	frappe.db.set_value(EOS, doc.name, "workflow_state", state, update_modified=False)
	return frappe.get_doc(EOS, doc.name)


def attach(doctype: str, name: str, file_name: str, content: bytes, owner: str | None = None) -> str:
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": doctype,
			"attached_to_name": name,
			"is_private": 1,
			"content": content,
		}
	).insert()
	if owner:
		frappe.db.set_value("File", file.name, "owner", owner, update_modified=False)
	return file.name


def version(doctype: str, name: str, changes: list, owner: str = "Administrator", days_ago: int = 0) -> None:
	row = frappe.get_doc(
		{"doctype": "Version", "ref_doctype": doctype, "docname": name, "data": json.dumps({"changed": changes})}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Version", row.name, {"owner": owner, "creation": add_days(now_datetime(), -days_ago)}, update_modified=False)


def pdf_bytes(created: str | None = None, modified: str | None = None, producer: str | None = None, incremental: bool = False) -> bytes:
	pdf = pikepdf.new()
	pdf.add_blank_page()
	for key, value in (("/CreationDate", created), ("/ModDate", modified), ("/Producer", producer)):
		if value:
			pdf.docinfo[key] = value
	buffer = io.BytesIO()
	pdf.save(buffer)
	if not incremental:
		return buffer.getvalue()
	writer = PdfWriter(io.BytesIO(buffer.getvalue()), incremental=True)
	writer.add_metadata({"/Title": "edited"})
	edited = io.BytesIO()
	writer.write(edited)
	return edited.getvalue()


def iban_update(employee_name: str, value: str, submitter: str) -> str:
	doc = frappe.get_doc(
		{
			"doctype": "IBAN Update",
			"employee": employee_name,
			"full_name": "Test Employee",
			"phone_no": "0500000000",
			"project": "Test",
			"iban": value,
			"account_holder_name": "Test Employee",
			"deceleration": 1,
		}
	).insert()
	frappe.db.set_value("IBAN Update", doc.name, "docstatus", 1, update_modified=False)
	comment = frappe.get_doc(
		{"doctype": "Comment", "comment_type": "Workflow", "reference_doctype": "IBAN Update", "reference_name": doc.name, "content": "Approved"}
	).insert(ignore_permissions=True)
	frappe.db.set_value("Comment", comment.name, "owner", submitter, update_modified=False)
	return doc.name


class TestPaymentAccountingChecks(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_amount_must_be_positive(self):
		self.assertEqual(status(pr(amount=0), "PR-ACC-01"), "fail")
		self.assertEqual(status(pr(amount=5), "PR-ACC-01"), "pass")

	def test_settlement_payment_reference_must_resolve_to_a_settlement(self):
		settlement = make_settlement(employee())
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number="Exit-0000-00000"), "PR-ACC-02"), "warn")
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number=settlement.name), "PR-ACC-02"), "pass")
		self.assertEqual(status(pr(payment_type="Other Payment"), "PR-ACC-02"), "na")

	def test_source_record_must_be_approved_following_amendments(self):
		pending = make_leave(employee(), state="Pending")
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=pending.name), "PR-ACC-03"), "warn")
		cancelled = make_leave(employee(), state="Cancelled")
		frappe.db.set_value(ALS, cancelled.name, "docstatus", 2, update_modified=False)
		amended = make_leave(cancelled.employee, state="Approved", amended_from=cancelled.name)
		item = verdict(pr(payment_type="Advance Leave Salary", tax_invoice_number=cancelled.name), "PR-ACC-03")
		self.assertEqual(item["status"], "pass")
		self.assertIn(amended.name, json.dumps(item["evidence"]))

	def test_amount_must_match_source_alone_or_with_sibling_requests(self):
		source = make_leave(employee(), state="Approved")
		frappe.db.set_value(ALS, source.name, "amount", 1000, update_modified=False)
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=source.name, amount=1000), "PR-ACC-04"), "pass")
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=source.name, amount=600), "PR-ACC-04"), "warn")
		make_pr(payment_type="Advance Leave Salary", tax_invoice_number=source.name, amount=400)
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=source.name, amount=600), "PR-ACC-04"), "pass")

	def test_requests_on_one_reference_must_not_exceed_the_source(self):
		source = make_settlement(employee(), state="Approved")
		frappe.db.set_value(EOS, source.name, "amount", 1000, update_modified=False)
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number=source.name, amount=1000), "PR-ACC-05"), "pass")
		make_pr(state="Paid", payment_type="SADAD Payment", tax_invoice_number=source.name, amount=200)
		self.assertEqual(status(pr(payment_type="SADAD Payment", tax_invoice_number=source.name, amount=200), "PR-ACC-04"), "na")
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number=source.name, amount=1000), "PR-ACC-05"), "pass")
		make_pr(state="Pending", payment_type="EOS", tax_invoice_number=source.name, amount=700)
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number=source.name, amount=500), "PR-ACC-05"), "warn")

	def test_closed_request_is_not_added_to_its_own_reference_total(self):
		source = make_leave(employee(), state="Approved")
		frappe.db.set_value(ALS, source.name, "amount", 1000, update_modified=False)
		make_pr(payment_type="Advance Leave Salary", tax_invoice_number=source.name, amount=1000)
		for state in ("Rejected", "Cancelled"):
			closed = make_pr(state=state, payment_type="Advance Leave Salary", tax_invoice_number=source.name, amount=600)
			with self.subTest(state=state):
				self.assertEqual(status(closed, "PR-ACC-05"), "pass")
				self.assertEqual(status(closed, "PR-ACC-04"), "pass")

	def test_cost_center_must_be_set(self):
		self.assertEqual(status(pr(project=None), "PR-ACC-06"), "warn")
		self.assertEqual(status(pr(project="Main - AF"), "PR-ACC-06"), "pass")

	def test_remark_must_have_fifteen_characters(self):
		self.assertEqual(status(pr(remark="<p>short</p>"), "PR-ACC-07"), "warn")
		self.assertEqual(status(pr(remark="Rent for the Riyadh office"), "PR-ACC-07"), "pass")

	def test_urgent_request_needs_a_reason_and_shows_it(self):
		self.assertEqual(status(pr(if_it__urgent=1, reason_of_urgency=""), "PR-ACC-08"), "warn")
		item = verdict(pr(if_it__urgent=1, reason_of_urgency="Visa expires tomorrow"), "PR-ACC-08")
		self.assertEqual(item["status"], "pass")
		self.assertIn("Visa expires tomorrow", json.dumps(item["evidence"]))
		self.assertEqual(status(pr(if_it__urgent=0), "PR-ACC-08"), "na")

	def test_already_paid_flag_is_shown_as_information(self):
		item = verdict(pr(verify_payment=1), "PR-ACC-09")
		self.assertEqual((item["status"], item["severity"]), ("warn", "info"))
		self.assertEqual(status(pr(verify_payment=0), "PR-ACC-09"), "pass")


class TestPaymentAttachmentChecks(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_request_without_a_file_fails_and_a_file_passes_without_claiming_content(self):
		bare = make_pr()
		self.assertEqual(status(bare, "PR-ATT-01"), "fail")
		attach(PR, bare.name, "invoice.pdf", pdf_bytes())
		item = verdict(bare, "PR-ATT-01")
		self.assertEqual(item["status"], "pass")
		self.assertIn("content not verified", item["detail"])

	def test_corrupt_file_is_flagged_and_a_clean_pdf_opens(self):
		clean = make_pr()
		attach(PR, clean.name, "clean.pdf", pdf_bytes())
		self.assertEqual(status(clean, "PR-ATT-02"), "pass")
		corrupt = make_pr()
		attach(PR, corrupt.name, "corrupt.png", b"this is not an image")
		self.assertEqual(status(corrupt, "PR-ATT-02"), "warn")

	def test_same_file_on_a_request_to_another_account_is_flagged(self):
		content = pdf_bytes(producer=frappe.generate_hash())
		first = make_pr()
		attach(PR, first.name, "shared.pdf", content)
		same_account = make_pr(account_no=first.account_no)
		attach(PR, same_account.name, "shared.pdf", content)
		self.assertEqual(status(same_account, "PR-ATT-03"), "pass")
		other_account = make_pr()
		attach(PR, other_account.name, "shared.pdf", content)
		self.assertEqual(status(other_account, "PR-ATT-03"), "warn")

	def test_file_added_by_another_user_after_the_last_step_is_listed(self):
		make_user(OTHER_USER, "System Manager")
		doc = make_pr()
		version(PR, doc.name, [["workflow_state", "Pending", "Waiting P.M Approval"]], days_ago=1)
		attach(PR, doc.name, "own.pdf", pdf_bytes())
		self.assertEqual(status(doc, "PR-ATT-04"), "pass")
		attach(PR, doc.name, "late.pdf", pdf_bytes(), owner=OTHER_USER)
		self.assertEqual(status(doc, "PR-ATT-04"), "warn")

	def test_pdf_edited_after_creation_is_flagged(self):
		clean = make_pr()
		attach(PR, clean.name, "clean.pdf", pdf_bytes(created="D:20260101000000", modified="D:20260101000000"))
		self.assertEqual(status(clean, "PR-ATT-05"), "pass")
		edited = make_pr()
		attach(PR, edited.name, "edited.pdf", pdf_bytes(created="D:20260101000000", modified="D:20260301000000", incremental=True))
		item = verdict(edited, "PR-ATT-05")
		self.assertEqual(item["status"], "warn")
		self.assertIn("incremental", json.dumps(item["evidence"]))

	def test_invoice_qr_reading_reports_not_enabled_on_invoice_types_only(self):
		self.assertEqual(status(pr(payment_type="Purchases"), "PR-ATT-06"), "unknown")
		self.assertEqual(status(pr(payment_type="EOS"), "PR-ATT-06"), "na")


class TestPaymentBeneficiaryChecks(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_iban_checksum_failure_blocks_and_shape_or_bank_code_warns(self):
		item = verdict(pr(account_no=broken_checksum(iban())), "PR-BEN-01")
		self.assertEqual((item["status"], item["severity"]), ("fail", "block"))
		item = verdict(pr(account_no="12345"), "PR-BEN-01")
		self.assertEqual((item["status"], item["severity"]), ("warn", "warn"))
		self.assertEqual(status(pr(account_no=iban("99")), "PR-BEN-01"), "warn")
		self.assertEqual(status(pr(account_no=iban("10")), "PR-BEN-01"), "pass")

	def test_snb_account_passes_only_on_intra_ncb_and_non_bank_modes_are_skipped(self):
		self.assertEqual(status(pr(account_no="12345678901234", mode_of_payment="Intra-NCB Transfer"), "PR-BEN-01"), "pass")
		self.assertEqual(status(pr(account_no="12345678901234", mode_of_payment="Local Bank Transfer"), "PR-BEN-01"), "warn")
		self.assertEqual(status(pr(account_no="NOT AN ACCOUNT", mode_of_payment="Cash Payment"), "PR-BEN-01"), "na")

	def test_settlement_payment_account_must_match_the_employee(self):
		staff = employee()
		settlement = make_settlement(staff)
		bank = frappe.db.get_value("Employee", staff, "bank_ac_no")
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number=settlement.name, account_no=bank), "PR-BEN-02"), "pass")
		self.assertEqual(status(pr(payment_type="EOS", tax_invoice_number=settlement.name, account_no=iban()), "PR-BEN-02"), "warn")

	def test_iban_update_passes_only_when_submitted_by_someone_other_than_requester_and_approver(self):
		make_user(OTHER_USER, "System Manager")
		staff = employee()
		leave = make_leave(staff)
		new_account = iban()
		iban_update(staff, new_account, submitter=OTHER_USER)
		by_requester = pr(payment_type="Advance Leave Salary", tax_invoice_number=leave.name, account_no=new_account, owner=OTHER_USER)
		self.assertEqual(status(by_requester, "PR-BEN-02"), "warn")
		by_other = pr(payment_type="Advance Leave Salary", tax_invoice_number=leave.name, account_no=new_account, owner="Guest")
		self.assertEqual(status(by_other, "PR-BEN-02"), "pass")

	def test_bank_change_by_the_requester_warns_at_any_age_and_others_only_within_thirty_days(self):
		make_user(OTHER_USER, "System Manager")
		staff = employee()
		leave = make_leave(staff)
		doc = pr(payment_type="Advance Leave Salary", tax_invoice_number=leave.name, owner=OTHER_USER)
		self.assertEqual(status(doc, "PR-BEN-03"), "pass")
		version("Employee", staff, [["bank_ac_no", iban(), iban()]], owner="Guest", days_ago=60)
		self.assertEqual(status(doc, "PR-BEN-03"), "pass")
		version("Employee", staff, [["bank_ac_no", iban(), iban()]], owner=OTHER_USER, days_ago=60)
		self.assertEqual(status(doc, "PR-BEN-03"), "warn")
		recent = employee()
		version("Employee", recent, [["bank_ac_no", iban(), iban()]], owner="Guest", days_ago=5)
		recent_leave = make_leave(recent)
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=recent_leave.name), "PR-BEN-03"), "warn")

	def test_beneficiary_name_is_required_except_for_sadad(self):
		self.assertEqual(status(pr(beneficiary_name=""), "PR-BEN-04"), "warn")
		self.assertEqual(status(pr(beneficiary_name="STC"), "PR-BEN-04"), "pass")
		self.assertEqual(status(pr(beneficiary_name="", payment_type="SADAD Payment"), "PR-BEN-04"), "na")

	def test_beneficiary_name_matches_employee_across_arabic_spelling_forms(self):
		staff = employee(first_name="أحمد")
		frappe.db.set_value("Employee", staff, "employee_name", "أحمد علي الزهراني")
		leave = make_leave(staff)
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=leave.name, beneficiary_name="احمد على الزهرانى"), "PR-BEN-05"), "pass")
		self.assertEqual(status(pr(payment_type="Advance Leave Salary", tax_invoice_number=leave.name, beneficiary_name="Some Other Person"), "PR-BEN-05"), "warn")

	def test_account_history_shows_first_payment_and_hides_from_non_audit_roles(self):
		first = pr()
		self.assertEqual(status(first, "PR-BEN-06"), "warn")
		earlier = make_pr()
		frappe.db.set_value(PR, earlier.name, "creation", add_days(now_datetime(), -40), update_modified=False)
		self.assertEqual(status(pr(account_no=earlier.account_no), "PR-BEN-06"), "pass")
		make_user(PLAIN_READER, "HR Manager")
		frappe.set_user(PLAIN_READER)
		item = verdict(pr(account_no=earlier.account_no), "PR-BEN-06")
		self.assertEqual(item["status"], "na")
		self.assertNotIn(earlier.name, json.dumps(item))

	def test_supplier_payment_to_an_employee_account_is_flagged(self):
		account = iban()
		employee(account)
		self.assertEqual(status(pr(payment_type="Purchases", account_no=account), "PR-BEN-07"), "warn")
		self.assertEqual(status(pr(payment_type="Purchases"), "PR-BEN-07"), "pass")

	def test_account_shared_by_two_active_employees_is_flagged(self):
		account = iban()
		employee(account)
		self.assertEqual(status(pr(account_no=account), "PR-BEN-08"), "pass")
		employee(account)
		self.assertEqual(status(pr(account_no=account), "PR-BEN-08"), "warn")

	def test_payment_to_a_departed_employee_account_is_flagged_outside_final_dues(self):
		account = iban()
		employee(account, status="Left", relieving_date="2025-01-01")
		self.assertEqual(status(pr(account_no=account), "PR-BEN-09"), "warn")
		self.assertEqual(status(pr(account_no=account, payment_type="EOS"), "PR-BEN-09"), "na")
		self.assertEqual(status(pr(), "PR-BEN-09"), "pass")


class TestPaymentPolicyAndFraudChecks(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_approver_who_created_the_request_is_warned(self):
		self.assertEqual(status(pr(owner="Administrator"), "PR-POL-01"), "warn")
		self.assertEqual(status(pr(owner="Guest"), "PR-POL-01"), "pass")

	def test_approver_who_moved_an_earlier_approval_step_is_warned(self):
		doc = make_pr(state="Waiting Manager Approval")
		version(PR, doc.name, [["workflow_state", "Pending", "Waiting P.M Approval"]])
		self.assertEqual(status(doc, "PR-POL-02"), "pass")
		version(PR, doc.name, [["workflow_state", "Waiting P.M Approval", "Financial Controller"]])
		item = verdict(doc, "PR-POL-02")
		self.assertEqual((item["status"], item["severity"]), ("warn", "info"))

	def test_same_amount_to_same_account_within_fourteen_days_warns_unless_monthly(self):
		account = iban()
		make_pr(account_no=account, amount=777, date=add_days(nowdate(), -10))
		item = verdict(pr(account_no=account, amount=777), "PR-FRD-01")
		self.assertEqual((item["status"], item["severity"]), ("warn", "warn"))
		self.assertEqual(status(pr(account_no=account, amount=778), "PR-FRD-01"), "pass")
		monthly = iban()
		for days in (100, 70, 40, 10):
			make_pr(account_no=monthly, amount=500, date=add_days(nowdate(), -days))
		item = verdict(pr(account_no=monthly, amount=500), "PR-FRD-01")
		self.assertEqual((item["status"], item["severity"]), ("warn", "info"))

	def test_rejected_duplicate_is_not_counted(self):
		account = iban()
		make_pr(state="Rejected", account_no=account, amount=321, date=add_days(nowdate(), -3))
		self.assertEqual(status(pr(account_no=account, amount=321), "PR-FRD-01"), "pass")

	def test_ai_reading_reports_not_enabled_without_a_key(self):
		item = verdict(pr(), "PR-FRD-02")
		self.assertEqual((item["status"], item["mode"]), ("unknown", "ai"))

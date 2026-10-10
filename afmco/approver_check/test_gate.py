# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.model.workflow import get_workflow_name, is_transition_condition_satisfied
from frappe.tests import IntegrationTestCase

from afmco.approver_check import engine
from afmco.approver_check.registry import APPROVER_STATES
from afmco.approver_check.test_checks_payment import (
	ALS,
	EOS,
	PR,
	attach,
	employee,
	make_leave,
	make_pr,
	make_settlement,
	pdf_bytes,
)
from afmco.financial_operations.api.approver_check import run
from afmco.people_and_payroll.api.test_employee_financial_summary import make_user

APPROVER = "approver-check-approver@afmco.test"
BYSTANDER = "approver-check-bystander@afmco.test"
REQUESTER = "approver-check-requester@afmco.test"
READER_ROLES = {PR: "HR Manager", ALS: "HR User", EOS: "Support Team"}
EMPLOYEE_ROWS = ("PR-BEN-02", "PR-BEN-03", "PR-BEN-05")
LEAVE_EMPLOYEE_ROWS = ("ALS-ACC-02", "ALS-ACC-03", "ALS-POL-05", "ALS-BEN-02", "ALS-BEN-03")
DISTINCT_WAGE = 3217
DISTINCT_HOUSING = 911


def record_in(doctype: str, state: str):
	if doctype == PR:
		return make_pr(state=state, verify_payment=0)
	if doctype == ALS:
		return make_leave(employee(), state=state)
	return make_settlement(employee(), state=state)


def transition_role(doc) -> str | None:
	workflow = frappe.get_doc("Workflow", get_workflow_name(doc.doctype))
	for transition in workflow.transitions:
		if transition.state == doc.workflow_state and is_transition_condition_satisfied(transition, doc):
			return transition.allowed
	return None


def counts(doc) -> dict:
	return {
		"modified": str(frappe.db.get_value(doc.doctype, doc.name, "modified")),
		"versions": frappe.db.count("Version", {"ref_doctype": doc.doctype, "docname": doc.name}),
		"files": frappe.db.count("File"),
		"comments": frappe.db.count("Comment", {"reference_name": doc.name}),
		"errors": frappe.db.count("Error Log"),
	}


def onload_flag(doc) -> bool:
	fresh = frappe.get_doc(doc.doctype, doc.name)
	fresh.run_method("onload")
	return bool(fresh.get_onload().get("approver_check_allowed"))


class TestApproverGate(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_every_approver_state_returns_the_checklist_to_its_transition_role(self):
		for doctype, states in APPROVER_STATES.items():
			for state in states:
				with self.subTest(doctype=doctype, state=state):
					frappe.set_user("Administrator")
					doc = record_in(doctype, state)
					role = transition_role(doc)
					self.assertTrue(role, f"no transition leaves {state}")
					make_user(APPROVER, role, READER_ROLES[doctype])
					frappe.set_user(APPROVER)
					payload = run(doctype, doc.name)
					self.assertEqual(payload["name"], doc.name)
					self.assertTrue(payload["items"])
					self.assertTrue(onload_flag(doc))

	def test_reader_without_a_transition_is_refused(self):
		doc = record_in(PR, "Waiting P.M Approval")
		make_user(BYSTANDER, READER_ROLES[PR])
		frappe.set_user(BYSTANDER)
		self.assertFalse(onload_flag(doc))
		self.assertRaises(frappe.PermissionError, run, PR, doc.name)

	def test_requester_at_pending_is_refused(self):
		make_user(REQUESTER, "Request User")
		frappe.set_user(REQUESTER)
		doc = make_pr(state=None)
		self.assertEqual(frappe.db.get_value(PR, doc.name, "workflow_state"), "Pending")
		self.assertRaises(frappe.PermissionError, run, PR, doc.name)

	def test_doctype_outside_the_registry_is_refused(self):
		self.assertRaises(frappe.PermissionError, run, "ToDo", "anything")

	def test_running_the_check_writes_nothing(self):
		doc = record_in(PR, "Waiting P.M Approval")
		attach(PR, doc.name, "invoice.pdf", pdf_bytes())
		make_user(APPROVER, "Projects Manager")
		before = counts(doc)
		frappe.set_user(APPROVER)
		run(PR, doc.name)
		frappe.set_user("Administrator")
		self.assertEqual(counts(doc), before)


class TestApproverPermissionScope(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def test_approver_without_employee_read_sees_could_not_verify_and_no_employee_value(self):
		staff = employee()
		frappe.db.set_value("Employee", staff, "employee_name", "Hidden Employee Name")
		bank = frappe.db.get_value("Employee", staff, "bank_ac_no")
		settlement = make_settlement(staff)
		doc = make_pr(payment_type="EOS", tax_invoice_number=settlement.name, account_no="SA0000000000000000000000", beneficiary_name="Someone")
		make_user(APPROVER, "Projects Manager")
		frappe.set_user(APPROVER)
		self.assertFalse(frappe.has_permission("Employee", "read"))
		payload = run(PR, doc.name)
		rows = {item["id"]: item for item in payload["items"]}
		for check_id in EMPLOYEE_ROWS:
			self.assertEqual(rows[check_id]["status"], "unknown", check_id)
		text = json.dumps(payload, default=str)
		self.assertNotIn(bank, text)
		self.assertNotIn("Hidden Employee Name", text)

	def test_audit_history_row_is_hidden_from_non_audit_approvers(self):
		doc = record_in(PR, "Waiting Bank Entry")
		make_user(APPROVER, "Bank User")
		frappe.set_user(APPROVER)
		rows = {item["id"]: item for item in run(PR, doc.name)["items"]}
		self.assertEqual(rows["PR-BEN-06"]["status"], "na")
		frappe.set_user("Administrator")
		make_user(APPROVER, "Projects Manager")
		doc = record_in(PR, "Waiting P.M Approval")
		frappe.set_user(APPROVER)
		rows = {item["id"]: item for item in run(PR, doc.name)["items"]}
		self.assertNotEqual(rows["PR-BEN-06"]["status"], "na")

	def test_accountant_who_reads_the_leave_salary_but_not_the_employee_sees_could_not_verify(self):
		staff = employee(basic_wage=DISTINCT_WAGE)
		leave = make_leave(staff, state="Waiting Accountant Approval")
		make_user(APPROVER, "Accounts User")
		frappe.set_user(APPROVER)
		self.assertTrue(frappe.has_permission(ALS, "read", doc=leave))
		self.assertFalse(frappe.has_permission("Employee", "read"))
		payload = run(ALS, leave.name)
		rows = {item["id"]: item for item in payload["items"]}
		for check_id in LEAVE_EMPLOYEE_ROWS:
			self.assertEqual(rows[check_id]["status"], "unknown", check_id)
		self.assertNotIn(str(DISTINCT_WAGE), json.dumps(payload, default=str))

	def test_actual_wage_is_shown_only_to_readers_of_the_restricted_wage_fields(self):
		staff = employee(basic_wage=3000, housing_2=DISTINCT_HOUSING)
		leave = make_leave(staff, state="Waiting Manager Approval", total_salary=3000)
		make_user(BYSTANDER, "HR User")
		frappe.set_user(BYSTANDER)
		item = next(row for row in engine.run(leave)["items"] if row["id"] == "ALS-ACC-02")
		self.assertEqual(item["status"], "pass")
		self.assertNotIn(str(3000 + DISTINCT_HOUSING), json.dumps(item))
		frappe.set_user("Administrator")
		item = next(row for row in engine.run(leave)["items"] if row["id"] == "ALS-ACC-02")
		self.assertIn(str(3000 + DISTINCT_HOUSING), json.dumps(item))

	def test_user_permission_restricting_employees_hides_other_employees_rows(self):
		staff = employee()
		visible = employee()
		leave = make_leave(staff, state="Waiting Manager Approval")
		make_user(BYSTANDER, "HR User")
		frappe.get_doc({"doctype": "User Permission", "user": BYSTANDER, "allow": "Employee", "for_value": visible, "apply_to_all_doctypes": 0, "applicable_for": "Employee"}).insert()
		frappe.set_user(BYSTANDER)
		self.assertFalse(frappe.has_permission("Employee", "read", doc=frappe.get_doc("Employee", staff)))
		item = next(row for row in engine.run(leave)["items"] if row["id"] == "ALS-ACC-03")
		self.assertEqual(item["status"], "unknown")

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json
import time
from unittest import mock

import frappe
from frappe.model.workflow import get_transitions, get_workflow_name, is_transition_condition_satisfied
from frappe.tests import IntegrationTestCase
from frappe.utils import add_to_date

from afmco.approver_check import engine
from afmco.approver_check.model import PASS, Check, Result, evidence
from afmco.approver_check.checks_payment import AUDIT_ROLES
from afmco.approver_check.registry import APPROVER_STATES, REGISTRY
from afmco.approver_check.test_checks_payment import (
	ALS,
	EOS,
	PR,
	attach,
	employee,
	iban_update,
	make_leave,
	make_pr,
	make_settlement,
	pdf_bytes,
)
from afmco.approver_check.test_iban import iban
from afmco.financial_operations.api.approver_check import get_result, run
from afmco.people_and_payroll.api.test_employee_financial_summary import make_user

APPROVER = "approver-check-approver@afmco.test"
BYSTANDER = "approver-check-bystander@afmco.test"
REQUESTER = "approver-check-requester@afmco.test"
READER_ROLES = {PR: "HR Manager", ALS: "HR User", EOS: "Support Team"}
EMPLOYEE_ROWS = ("PR-BEN-02", "PR-BEN-03", "PR-BEN-05")
LEAVE_EMPLOYEE_ROWS = ("ALS-ACC-02", "ALS-ACC-03", "ALS-POL-05", "ALS-BEN-02", "ALS-BEN-03")
DISTINCT_WAGE = 3217
DISTINCT_HOUSING = 911
DISTINCT_SETTLEMENT_WAGE = 5333
OWN_WAGE = 4111
SELECT_ONLY_ROLE = "Approver Check Select Only"


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

	def test_auditor_bank_and_upload_steps_are_refused_to_a_projects_manager(self):
		steps = (
			("Financial Controller", "Auditor"),
			("Waiting Bank Entry", "Bank User"),
			("Document Upload", "Auditor"),
		)
		for state, role in steps:
			with self.subTest(state=state, role=role):
				frappe.set_user("Administrator")
				doc = record_in(PR, state)
				make_user(APPROVER, role, "Projects Manager")
				frappe.set_user(APPROVER)
				self.assertTrue(get_transitions(doc))
				self.assertFalse(onload_flag(doc))
				self.assertRaises(frappe.PermissionError, run, PR, doc.name)

	def test_general_manager_and_projects_manager_at_their_own_step_run_the_check(self):
		for state, role in (("Waiting P.M Approval", "Projects Manager"), ("Waiting Manager Approval", "General Manager")):
			with self.subTest(state=state, role=role):
				frappe.set_user("Administrator")
				doc = record_in(PR, state)
				make_user(APPROVER, role)
				frappe.set_user(APPROVER)
				self.assertTrue(onload_flag(doc))
				self.assertTrue(run(PR, doc.name)["items"])

	def test_hr_and_accounts_steps_of_leave_salary_and_settlement_are_refused(self):
		for doctype, state, role in ((ALS, "Waiting Manager Approval", "HR Manager"), (ALS, "Waiting Accountant Approval", "Accounts User"), (EOS, "Waiting Manager Approval", "HR Manager"), (EOS, "Legal", "Legal user")):
			with self.subTest(doctype=doctype, state=state):
				frappe.set_user("Administrator")
				doc = record_in(doctype, state)
				make_user(APPROVER, role)
				frappe.set_user(APPROVER)
				self.assertTrue(get_transitions(doc))
				self.assertFalse(onload_flag(doc))
				self.assertRaises(frappe.PermissionError, run, doctype, doc.name)

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

	def test_audit_history_row_is_hidden_from_a_reader_outside_the_audit_roles(self):
		doc = record_in(PR, "Waiting P.M Approval")
		make_user(APPROVER, "Projects Manager")
		make_user(BYSTANDER, "Bank User")
		self.assertNotIn("Bank User", AUDIT_ROLES)
		frappe.set_user(APPROVER)
		rows = {item["id"]: item for item in run(PR, doc.name)["items"]}
		self.assertNotEqual(rows["PR-BEN-06"]["status"], "na")
		frappe.set_user(BYSTANDER)
		rows = {item["id"]: item for item in engine.serve(doc, engine.stored_items(doc))["items"]}
		self.assertEqual(rows["PR-BEN-06"]["status"], "na")

	def test_accountant_who_reads_the_leave_salary_but_not_the_employee_sees_could_not_verify(self):
		staff = employee(basic_wage=DISTINCT_WAGE)
		leave = make_leave(staff, state="Waiting Accountant Approval")
		make_user(APPROVER, "Accounts User")
		frappe.set_user(APPROVER)
		self.assertTrue(frappe.has_permission(ALS, "read", doc=leave))
		self.assertFalse(frappe.has_permission("Employee", "read"))
		payload = engine.run(leave)
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

	def test_no_approver_at_any_step_receives_employee_or_source_values_it_cannot_read(self):
		def hidden_worker():
			staff = employee(basic_wage=DISTINCT_WAGE, housing_2=DISTINCT_HOUSING, employee_name="Zzqx Hidden Worker")
			iban_update(staff, iban(), "Administrator")
			return staff

		staff = hidden_worker()
		settlement = make_settlement(staff, total_salary=DISTINCT_SETTLEMENT_WAGE)
		records = [make_pr(state=state, payment_type="EOS", tax_invoice_number=settlement.name, account_no=iban(), beneficiary_name="Zzqx Worker", verify_payment=0) for state in APPROVER_STATES[PR]]
		records += [make_leave(staff, state=state, total_salary=OWN_WAGE) for state in APPROVER_STATES[ALS]]
		records += [make_settlement(hidden_worker(), state=state, total_salary=OWN_WAGE) for state in APPROVER_STATES[EOS]]
		checked = 0
		for doc in records:
			role = transition_role(doc)
			if not role:
				continue
			worker = doc.get("employee") or staff
			secrets = (
				("Employee", worker, (frappe.db.get_value("Employee", worker, "bank_ac_no"), str(DISTINCT_WAGE), str(DISTINCT_HOUSING), "Zzqx Hidden Worker")),
				(EOS, settlement.name, (str(DISTINCT_SETTLEMENT_WAGE),)),
			)
			with self.subTest(doctype=doc.doctype, state=doc.workflow_state, role=role):
				frappe.set_user("Administrator")
				make_user(APPROVER, role)
				frappe.set_user(APPROVER)
				if not engine.approver_allowed(doc):
					continue
				text = json.dumps(run(doc.doctype, doc.name), default=str)
				own = json.dumps(doc.as_dict(), default=str)
				checked += 1
				for doctype, target, values in secrets:
					if frappe.has_permission(doctype, "read", doc=target):
						continue
					for value in values:
						if value not in own:
							self.assertNotIn(value, text, f"{doctype} value {value} reached {role}")
		self.assertEqual(checked, sum(len(states) for states in APPROVER_STATES.values()))

	def test_select_only_permission_on_iban_update_does_not_reveal_it(self):
		frappe.get_doc({"doctype": "Role", "role_name": SELECT_ONLY_ROLE, "desk_access": 1}).insert(ignore_if_duplicate=True)
		frappe.get_doc({"doctype": "Custom DocPerm", "parent": "IBAN Update", "role": SELECT_ONLY_ROLE, "permlevel": 0, "select": 1, "read": 0}).insert()
		frappe.clear_cache(doctype="IBAN Update")
		self.addCleanup(frappe.clear_cache, doctype="IBAN Update")
		staff = employee()
		account = iban()
		update = iban_update(staff, account, "Administrator")
		leave = make_leave(staff, state="Waiting Manager Approval")
		frappe.db.set_value(ALS, leave.name, "account_no", account, update_modified=False)
		make_user(BYSTANDER, "HR User", SELECT_ONLY_ROLE)
		frappe.set_user(BYSTANDER)
		self.assertTrue(frappe.only_has_select_perm("IBAN Update"))
		item = next(row for row in engine.run(frappe.get_doc(ALS, leave.name))["items"] if row["id"] == "ALS-BEN-02")
		self.assertNotIn(update, json.dumps(item))
		self.assertEqual(item["status"], "warn")

	def test_endpoint_withholds_a_row_linking_a_record_the_approver_cannot_read(self):
		staff = employee(basic_wage=DISTINCT_WAGE)

		def careless(ctx):
			wage = frappe.db.get_value("Employee", staff, "basic_wage")
			return Result(PASS, f"wage {wage}", [evidence("Basic wage", wage, "Employee", staff)])

		doc = record_in(PR, "Waiting P.M Approval")
		make_user(APPROVER, transition_role(doc))
		frappe.set_user(APPROVER)
		self.assertFalse(frappe.has_permission("Employee", "read", doc=staff))
		with mock.patch.dict(REGISTRY, {PR: (Check("PR-T-01", "careless", "accounting", "Careless", "warn", careless),)}):
			payload = run(PR, doc.name)
		self.assertEqual(payload["items"][0]["status"], "unknown")
		self.assertNotIn(str(DISTINCT_WAGE), json.dumps(payload, default=str))


class TestApproverCheckDelivery(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def approver_on(self, doc):
		make_user(APPROVER, transition_role(doc))
		frappe.set_user(APPROVER)

	def test_check_running_past_its_limit_reports_not_finished(self):
		doc = record_in(PR, "Waiting P.M Approval")
		slow = Check("PR-T-02", "slow", "accounting", "Slow", "warn", lambda ctx: time.sleep(3) or Result(PASS))
		started = time.monotonic()
		with mock.patch.object(engine, "CHECK_SECONDS", 1):
			item = engine.run(doc, [slow])["items"][0]
		self.assertEqual(item["status"], "timeout")
		self.assertLess(time.monotonic() - started, 2.5)

	def test_attachment_reading_is_pending_then_served_from_the_stored_result(self):
		doc = record_in(PR, "Waiting P.M Approval")
		attach(PR, doc.name, "invoice.pdf", pdf_bytes())
		doc.reload()
		self.approver_on(doc)
		background = {check.id for check in REGISTRY[PR] if check.background}
		first = {item["id"]: item["status"] for item in run(PR, doc.name)["items"]}
		self.assertTrue(background)
		self.assertEqual({first[check_id] for check_id in background}, {"pending"})
		self.assertTrue(get_result(PR, doc.name)["pending"])
		with mock.patch("frappe.publish_realtime") as pushed:
			engine.run_background(PR, doc.name, str(doc.modified))
		self.assertEqual(pushed.call_args.kwargs["docname"], doc.name)
		ready = {item["id"]: item["status"] for item in get_result(PR, doc.name)["items"]}
		self.assertNotIn("pending", {ready[check_id] for check_id in background})
		again = {item["id"]: item["status"] for item in run(PR, doc.name)["items"]}
		self.assertEqual({again[check_id] for check_id in background}, {ready[check_id] for check_id in background})
		self.assertRaises(frappe.PermissionError, run, PR, doc.name, retry=1)

	def test_stored_result_belongs_to_one_document_version(self):
		doc = record_in(PR, "Waiting P.M Approval")
		self.approver_on(doc)
		run(PR, doc.name)
		with mock.patch("frappe.publish_realtime"):
			engine.run_background(PR, doc.name, "2000-01-01 00:00:00")
		self.assertTrue(get_result(PR, doc.name)["pending"])
		with mock.patch("frappe.publish_realtime"):
			engine.run_background(PR, doc.name, str(doc.modified))
		self.assertNotIn("pending", get_result(PR, doc.name))
		frappe.db.set_value(PR, doc.name, "modified", add_to_date(doc.modified, seconds=1), update_modified=False)
		self.assertTrue(get_result(PR, doc.name)["pending"])


class TestApproverCheckOncePerVersion(IntegrationTestCase):
	def tearDown(self):
		frappe.set_user("Administrator")

	def requisition_for_two_managers(self):
		staff = employee()
		frappe.db.set_value("Employee", staff, "employee_name", "Hidden Employee Name")
		settlement = make_settlement(staff)
		doc = make_pr(payment_type="EOS", tax_invoice_number=settlement.name, account_no="SA0000000000000000000000", beneficiary_name="Someone", verify_payment=0)
		make_user(APPROVER, "Projects Manager", "HR Manager")
		make_user(BYSTANDER, "Projects Manager")
		return staff, doc

	def press(self, doctype: str, name: str, **values):
		with mock.patch.object(engine, "compute", wraps=engine.compute) as shared_runs, mock.patch.object(engine, "evaluate", wraps=engine.evaluate) as evaluated:
			payload = run(doctype, name, **values)
		return payload, shared_runs.call_count, [call.args[0].id for call in evaluated.call_args_list]

	def test_second_press_by_a_reader_without_employee_read_runs_no_shared_check_and_sees_no_value(self):
		staff, leave = self.requisition_for_two_managers()
		frappe.set_user(APPROVER)
		first, runs, evaluated = self.press(PR, leave.name)
		self.assertEqual(runs, 1)
		self.assertNotEqual({row["id"]: row for row in first["items"]}["PR-BEN-05"]["status"], "unknown")
		frappe.set_user(BYSTANDER)
		self.assertFalse(frappe.has_permission("Employee", "read"))
		second, runs, evaluated = self.press(PR, leave.name)
		self.assertEqual(runs, 0)
		self.assertEqual(set(evaluated), {check.id for check in REGISTRY[PR] if check.viewer})
		rows = {row["id"]: row for row in second["items"]}
		for check_id in EMPLOYEE_ROWS:
			self.assertEqual(rows[check_id]["status"], "unknown", check_id)
		text = json.dumps(second, default=str)
		self.assertIn("Hidden Employee Name", json.dumps(first, default=str))
		self.assertNotIn("Hidden Employee Name", text)
		self.assertNotIn("needs", text)

	def test_editing_the_record_runs_the_shared_checks_once_more(self):
		staff, leave = self.requisition_for_two_managers()
		frappe.set_user(APPROVER)
		self.assertEqual(self.press(PR, leave.name)[1], 1)
		self.assertEqual(self.press(PR, leave.name)[1], 0)
		frappe.db.set_value(PR, leave.name, "modified", add_to_date(leave.modified, seconds=1), update_modified=False)
		self.assertEqual(self.press(PR, leave.name)[1], 1)
		self.assertEqual(self.press(PR, leave.name)[1], 0)

	def test_two_presses_before_the_first_result_is_stored_start_one_run(self):
		staff, leave = self.requisition_for_two_managers()
		with mock.patch.object(engine, "stored_items", return_value=None):
			frappe.set_user(APPROVER)
			first, first_runs, evaluated = self.press(PR, leave.name)
			frappe.set_user(BYSTANDER)
			second, second_runs, evaluated = self.press(PR, leave.name)
		self.assertEqual((first_runs, second_runs), (1, 0))
		self.assertEqual(evaluated, [])
		self.assertEqual({row["status"] for row in second["items"]}, {"pending"})
		self.assertEqual(self.press(PR, leave.name)[1], 0)

	def test_recheck_is_refused_to_an_approver_and_reruns_for_a_system_manager(self):
		staff, leave = self.requisition_for_two_managers()
		frappe.set_user(APPROVER)
		self.press(PR, leave.name)
		self.assertRaises(frappe.PermissionError, run, PR, leave.name, retry=1)
		frappe.set_user("Administrator")
		self.assertEqual(self.press(PR, leave.name, retry=1)[1], 1)

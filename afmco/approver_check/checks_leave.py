# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from datetime import timedelta

import frappe
from frappe import _, _lt
from frappe.utils import getdate

from afmco.approver_check.checks_common import (
	account_changed_recently,
	account_matches_employee,
	approver_not_requester,
	counted_rows,
	cva_row_amount_matches_formula,
	employee_active,
	has_attachment,
	iban_result,
	joining_matches_employee,
	leave_days_entitlement,
	period_already_settled,
	period_not_before_joining,
	stored_matches_recompute,
	ticket_only,
	wage_matches_employee,
)
from afmco.approver_check.model import (
	ACCOUNTING,
	ATTACHMENTS,
	BENEFICIARY,
	BLOCK,
	INFO,
	NA,
	PASS,
	POLICY,
	WARN,
	WARNING,
	Check,
	Context,
	Result,
	evidence,
)
from afmco.people_and_payroll.advance_leave_salary import ADVANCE_LEAVE_SALARY, recompute_advance

ADVANCE_WINDOW = timedelta(days=90)
SETTLED_OR_CLOSED_STATES = ("Approved", "Paid", "Cancelled", "Rejected")


def stored_amount_matches_recompute(ctx: Context) -> Result:
	return stored_matches_recompute(ctx, recompute_advance, ("amount", "cva_total", "deductions"))


def advance_within_90_days(ctx: Context) -> Result:
	rows = counted_rows(ctx.doc)
	if not rows:
		return Result(NA, _("No unpaid leave period is counted."))
	limit = ctx.today + ADVANCE_WINDOW
	early = [row for row in rows if row.contract_end_date and getdate(row.contract_end_date) > limit]
	if early:
		shown = [evidence(_("Row {0}").format(row.idx), row.contract_end_date) for row in early]
		return Result(WARN, _("{0} counted period(s) end more than 90 days from today.").format(len(early)), shown)
	return Result(PASS, _("Every counted period ends within 90 days of today."))


def no_other_open_als(ctx: Context) -> Result:
	doc = ctx.doc
	if ticket_only(doc):
		return Result(NA, _("This record pays tickets only."))
	rows = frappe.get_all(
		ADVANCE_LEAVE_SALARY,
		filters={"employee": doc.employee, "name": ["!=", doc.name], "docstatus": ["<", 2], "workflow_state": ["not in", SETTLED_OR_CLOSED_STATES]},
		fields=["name", "workflow_state", "cva_total", "number_of_tickets"],
	)
	rows = [row for row in rows if not ticket_only(row)]
	readable = ctx.readable_names(ADVANCE_LEAVE_SALARY, [row.name for row in rows])
	seen = [row for row in rows if row.name in readable]
	shown = [evidence(_("Open record"), f"{row.name} ({_(row.workflow_state)})", ADVANCE_LEAVE_SALARY, row.name) for row in seen]
	hidden = len(rows) - len(seen)
	if seen:
		return Result(WARN, _("The employee has {0} other leave salary record(s) awaiting approval.").format(len(seen)), shown)
	if hidden:
		return Result(WARN, _("The employee has {0} other leave salary record(s) awaiting approval that you cannot read.").format(hidden))
	return Result(PASS, _("The employee has no other leave salary record awaiting approval."))


def als_attachment(ctx: Context) -> Result:
	return has_attachment(ctx, WARN)


def als_iban_valid(ctx: Context) -> Result:
	return iban_result(ctx.doc.account_no)


def als_account_matches_employee(ctx: Context) -> Result:
	return account_matches_employee(ctx, ctx.doc.account_no, ctx.doc.employee, ctx.doc.owner)


def als_account_changed_recently(ctx: Context) -> Result:
	return account_changed_recently(ctx, ctx.doc.employee, ctx.doc.creation, ctx.doc.owner)


CHECKS = (
	Check("ALS-ACC-01", "stored_amount_matches_recompute", ACCOUNTING, _lt("Stored amounts match a fresh calculation"), WARNING, stored_amount_matches_recompute),
	Check("ALS-ACC-02", "wage_matches_employee", ACCOUNTING, _lt("Salary matches the employee record"), WARNING, wage_matches_employee),
	Check("ALS-ACC-03", "joining_date_matches_employee", ACCOUNTING, _lt("Joining date matches the employee record"), WARNING, joining_matches_employee),
	Check("ALS-ACC-04", "cva_row_amount_matches_formula", ACCOUNTING, _lt("Leave period amounts match the formula"), INFO, cva_row_amount_matches_formula),
	Check("ALS-POL-01", "period_already_settled", POLICY, _lt("Leave period not already settled"), BLOCK, period_already_settled),
	Check("ALS-POL-02", "leave_days_entitlement", POLICY, _lt("At least 21 leave days a year"), WARNING, leave_days_entitlement),
	Check("ALS-POL-03", "period_not_before_joining", POLICY, _lt("No period before the joining date"), WARNING, period_not_before_joining),
	Check("ALS-POL-04", "advance_within_90_days", POLICY, _lt("Advance requested within 90 days of the leave"), WARNING, advance_within_90_days),
	Check("ALS-POL-05", "employee_active", POLICY, _lt("Employee is active"), WARNING, employee_active),
	Check("ALS-POL-06", "no_other_open_als", POLICY, _lt("No other leave salary record awaiting approval"), WARNING, no_other_open_als),
	Check("ALS-ATT-01", "has_attachment", ATTACHMENTS, _lt("Supporting file attached"), INFO, als_attachment),
	Check("ALS-BEN-01", "iban_valid", BENEFICIARY, _lt("IBAN is valid"), BLOCK, als_iban_valid),
	Check("ALS-BEN-02", "account_matches_employee", BENEFICIARY, _lt("Account matches the employee record"), WARNING, als_account_matches_employee),
	Check("ALS-BEN-03", "account_changed_recently", BENEFICIARY, _lt("Employee bank account not changed recently"), WARNING, als_account_changed_recently),
	Check("ALS-POL-07", "approver_not_requester", POLICY, _lt("Approver is not the requester"), WARNING, approver_not_requester),
)

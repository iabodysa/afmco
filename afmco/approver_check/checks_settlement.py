# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe import _, _lt
from frappe.utils import cint, flt, getdate

from afmco.approver_check.attachments import attached_files, file_evidence
from afmco.approver_check.checks_common import (
	account_changed_recently,
	account_matches_employee,
	approver_not_requester,
	cva_row_amount_matches_formula,
	field_changes,
	has_attachment,
	iban_result,
	joining_matches_employee,
	period_already_settled,
	stored_matches_recompute,
	wage_matches_employee,
)
from afmco.approver_check.model import (
	ACCOUNTING,
	ATTACHMENTS,
	BENEFICIARY,
	BLOCK,
	FAIL,
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
from afmco.people_and_payroll.advance_leave_salary import (
	FULL_EOS_REASONS,
	NO_EOS_REASONS,
	PAID,
	RESIGNATION_REASONS,
	recompute_settlement,
)

CODED_REASONS = NO_EOS_REASONS | FULL_EOS_REASONS | RESIGNATION_REASONS
ARTICLE_80_CODES = ("3",)
FULL_AWARD_EXCEPTION_CODES = ("4", "5")
WORKER_INITIATED_CODES = ("5", "6", "7", "8")
WORKER_DEADLINE = 14
EMPLOYER_DEADLINE = 7
DEDUCTION_LIMIT = 0.5


def reason_code(doc) -> str:
	return (doc.end_of_service_reason or "")[:1]


def cash_payment(doc) -> bool:
	return bool(cint(doc.check3))


def stored_amount_matches_recompute(ctx: Context) -> Result:
	return stored_matches_recompute(ctx, recompute_settlement, ("total_eos", "days_of_eos", "amount"))


def reason_selected(ctx: Context) -> Result:
	reason = ctx.doc.end_of_service_reason
	if reason in CODED_REASONS:
		return Result(PASS, _("The end of service reason is {0}.").format(_(reason)))
	return Result(FAIL, _("No coded end of service reason is selected; the award cannot be calculated."))


def documented_reason(ctx: Context, codes: tuple[str, ...], needed: str) -> Result:
	if reason_code(ctx.doc) not in codes:
		return Result(NA, _("The reason does not need this document."))
	files = attached_files(ctx)
	if not files:
		return Result(WARN, needed + " " + _("No file is attached."))
	return Result(PASS, _("{0} file(s) attached; content not verified.").format(len(files)), file_evidence(files))


def article80_zero_award_documented(ctx: Context) -> Result:
	result = documented_reason(
		ctx,
		ARTICLE_80_CODES,
		_("Article 80 lets the employer end the contract without the end of service award of Articles 84 and 85 only in the cases it lists; attach the investigation record that proves the case."),
	)
	if result.status != NA:
		result.evidence.append(evidence(_("Articles 84 and 85"), award_articles()))
	return result


def award_articles() -> str:
	return _(
		"Article 84: half a month's wage for each of the first five years of service and a full month's wage for each later year. Article 85: a worker who resigns receives one third of that award after two to five years, two thirds after five to ten years, and the full award after ten years."
	)


def full_award_exception_documented(ctx: Context) -> Result:
	return documented_reason(ctx, FULL_AWARD_EXCEPTION_CODES, _("This reason pays the full award and needs a supporting document."))


def deductions_ratio(ctx: Context) -> Result:
	doc = ctx.doc
	taken = flt(doc.deductions) + flt(doc.penalty_clause)
	dues = flt(doc.total_eos) + flt(doc.cva_total) + flt(doc.alternative_reward) + flt(doc.ticket_allowance)
	shown = [evidence(_("Deductions and penalty"), taken), evidence(_("Final dues before deductions"), dues)]
	if taken <= 0:
		return Result(PASS, _("No deduction is taken from the final dues."), shown)
	if dues <= 0 or taken / dues > DEDUCTION_LIMIT:
		ratio = f"{taken / dues:.0%}" if dues > 0 else "-"
		return Result(
			WARN,
			_("Deductions are {0} of final dues, above 50%. Practitioners apply the Article 91-93 wage-deduction cap to final settlements by analogy; the legal reading is unresolved.").format(ratio),
			shown,
		)
	return Result(PASS, _("Deductions are {0} of final dues.").format(f"{taken / dues:.0%}"), shown)


def settlement_overdue(ctx: Context) -> Result:
	doc = ctx.doc
	if doc.workflow_state == PAID or not doc.date_2:
		return Result(NA, _("The settlement is paid or has no last working day."))
	deadline = WORKER_DEADLINE if reason_code(doc) in WORKER_INITIATED_CODES else EMPLOYER_DEADLINE
	waited = (ctx.today - getdate(doc.date_2)).days
	shown = [evidence(_("Last working day"), doc.date_2), evidence(_("Days since"), waited)]
	if waited > deadline:
		return Result(WARN, _("Unpaid {0} days after the last working day, beyond the {1} days of Article 88, which gives one week when the employer ends the contract and two weeks when the worker ends it.").format(waited, deadline), shown)
	return Result(PASS, _("Within the {0} days of Article 88, which gives one week when the employer ends the contract and two weeks when the worker ends it.").format(deadline), shown)


def eos_attachment(ctx: Context) -> Result:
	return has_attachment(ctx, WARN)


def eos_iban_valid(ctx: Context) -> Result:
	if cash_payment(ctx.doc):
		return Result(NA, _("The settlement is paid in cash."))
	return iban_result(ctx.doc.account_no)


def eos_account_matches_employee(ctx: Context) -> Result:
	if cash_payment(ctx.doc):
		return Result(NA, _("The settlement is paid in cash."))
	return account_matches_employee(ctx, ctx.doc.account_no, ctx.doc.employee, ctx.doc.owner)


def eos_account_changed_recently(ctx: Context) -> Result:
	anchor = min(getdate(ctx.doc.date_2), ctx.today) if ctx.doc.date_2 else ctx.today
	return account_changed_recently(ctx, ctx.doc.employee, anchor, ctx.doc.owner)


def cash_exception_documented(ctx: Context) -> Result:
	doc = ctx.doc
	if not cash_payment(doc):
		return Result(NA, _("The settlement is paid to a bank account."))
	changes = [change for change in field_changes(doc.doctype, doc.name, "check3") if str(change.new) in ("1", "True")]
	setter, when = (changes[-1].by, getdate(changes[-1].at)) if changes else (doc.owner, getdate(doc.creation))
	files = attached_files(ctx)
	shown = [evidence(_("Cash payment set by"), _("{0} on {1}").format(setter, when), "User", setter)] + file_evidence(files)
	if setter == ctx.user:
		return Result(FAIL, _("You set the cash payment yourself; another approver must review it."), shown)
	if not files:
		return Result(WARN, _("Cash payment is set and no file proves the account is suspended."), shown)
	return Result(WARN, _("Cash payment is set; read the attached proof that the account is suspended."), shown)


CHECKS = (
	Check("EOS-ACC-01", "stored_amount_matches_recompute", ACCOUNTING, _lt("Stored amounts match a fresh calculation"), WARNING, stored_amount_matches_recompute),
	Check("EOS-ACC-02", "wage_matches_employee", ACCOUNTING, _lt("Salary matches the employee record"), WARNING, wage_matches_employee),
	Check("EOS-ACC-03", "joining_date_matches_employee", ACCOUNTING, _lt("Joining date matches the employee record"), WARNING, joining_matches_employee),
	Check("EOS-ACC-04", "cva_row_amount_matches_formula", ACCOUNTING, _lt("Leave period amounts match the formula"), INFO, cva_row_amount_matches_formula),
	Check("EOS-POL-01", "reason_selected", POLICY, _lt("End of service reason is selected"), BLOCK, reason_selected),
	Check("EOS-POL-02", "article80_zero_award_documented", POLICY, _lt("Article 80 termination is documented"), WARNING, article80_zero_award_documented),
	Check("EOS-POL-03", "full_award_exception_documented", POLICY, _lt("Full award exception is documented"), WARNING, full_award_exception_documented),
	Check("EOS-POL-04", "deductions_ratio", POLICY, _lt("Deductions within half of final dues"), WARNING, deductions_ratio),
	Check("EOS-POL-05", "period_already_settled", POLICY, _lt("Leave period not already settled"), BLOCK, period_already_settled),
	Check("EOS-POL-06", "settlement_overdue", POLICY, _lt("Settlement paid on time"), INFO, settlement_overdue),
	Check("EOS-ATT-01", "has_attachment", ATTACHMENTS, _lt("Supporting file attached"), WARNING, eos_attachment),
	Check("EOS-BEN-01", "iban_valid", BENEFICIARY, _lt("IBAN is valid"), BLOCK, eos_iban_valid),
	Check("EOS-BEN-02", "account_matches_employee", BENEFICIARY, _lt("Account matches the employee record"), WARNING, eos_account_matches_employee, viewer=True),
	Check("EOS-BEN-03", "account_changed_recently", BENEFICIARY, _lt("Employee bank account not changed recently"), WARNING, eos_account_changed_recently, viewer=True),
	Check("EOS-BEN-04", "cash_exception_documented", BENEFICIARY, _lt("Cash payment exception is documented"), WARNING, cash_exception_documented, viewer=True),
	Check("EOS-POL-07", "approver_not_requester", POLICY, _lt("Approver is not the requester"), WARNING, approver_not_requester, viewer=True),
)

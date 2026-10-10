# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json
import re
from datetime import timedelta

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

from afmco.approver_check.attachments import attached_files, file_evidence
from afmco.approver_check.model import (
	BLOCK,
	EMPLOYEE,
	FAIL,
	NA,
	PASS,
	WARN,
	WARNING,
	Context,
	Result,
	Unverifiable,
	evidence,
	no_permission,
)
from afmco.people_and_payroll.advance_leave_salary import (
	ADVANCE_LEAVE_SALARY,
	END_OF_SERVICE,
	PAID,
	PERIOD_DOCTYPE,
	SETTLED_STATES,
	daily_wage,
	js_round,
	overlaps,
)
from afmco.people_and_payroll.iban import (
	BANK_CODE,
	CHECKSUM,
	MISSING,
	SHAPE,
	normalise_account,
	parse_saudi_iban,
)

IBAN_UPDATE = "IBAN Update"
VERSION = "Version"
RECENT_CHANGE = timedelta(days=30)
BOUNDARY_OVERLAP_DAYS = 31
MONEY_TOLERANCE = 1
ACTUAL_WAGE_FIELDS = ("basic_wage", "housing_2", "other_allowance_2")
ARABIC_MARKS = re.compile("[ً-ْـ]")
ARABIC_FOLDS = str.maketrans({"أ": "ا", "إ": "ا", "آ": "ا", "ؤ": "و", "ئ": "ي", "ة": "ه", "ى": "ي"})
NAME_TOKEN = re.compile(r"[^\W\d_]{2,}")


def account_sql(column: str) -> str:
	return f"replace(replace(replace(replace(replace(upper({column}), ' ', ''), '-', ''), '_', ''), char(9), ''), char(10), '')"


def iban_result(value) -> Result:
	ok, reason, bank = parse_saudi_iban(value)
	shown = [evidence(_("Account"), normalise_account(value))]
	if ok:
		return Result(PASS, _("Valid Saudi IBAN, bank {0}.").format(bank), shown)
	if reason == MISSING:
		return Result(FAIL, _("No account number is entered."), shown)
	if reason == SHAPE:
		return Result(WARN, _("The account is not in the Saudi IBAN format."), shown, severity=WARNING)
	if reason == CHECKSUM:
		return Result(FAIL, _("The IBAN check digits are wrong; the number is mistyped or invented."), shown)
	if reason == BANK_CODE:
		return Result(WARN, _("Bank code {0} is not a known Saudi bank.").format(normalise_account(value)[4:6]), shown, severity=WARNING)
	raise Unverifiable(_("The account could not be read."))


def approver_not_requester(ctx: Context) -> Result:
	owner = ctx.doc.owner
	shown = [evidence(_("Requested by"), owner, "User", owner)]
	if ctx.user == owner:
		return Result(WARN, _("You created this request and are now approving it."), shown)
	return Result(PASS, _("You did not create this request."), shown)


def has_attachment(ctx: Context, missing_status: str) -> Result:
	files = attached_files(ctx)
	if not files:
		return Result(missing_status, _("No file is attached."))
	return Result(PASS, _("{0} file(s) attached; content not verified.").format(len(files)), file_evidence(files))


def employees_with_account(ctx: Context, account: str) -> list[dict]:
	normalised = normalise_account(account)
	if not normalised:
		return []
	if not ctx.may_read_employee_fields(("bank_ac_no", "status")):
		raise no_permission()

	def load():
		rows = frappe.db.sql(
			f"select name, employee_name, status, relieving_date from `tabEmployee` where {account_sql('bank_ac_no')} = %s",
			normalised,
			as_dict=True,
		)
		readable = ctx.readable_names(EMPLOYEE, [row.name for row in rows])
		return [row for row in rows if row.name in readable]

	return ctx.remember(("employees_with_account", normalised), load)


def employee_links(rows: list[dict]) -> list[dict]:
	return [evidence(_("Employee"), f"{row.employee_name} ({row.status})", EMPLOYEE, row.name) for row in rows]


def field_changes(doctype: str, name: str, fieldname: str, normalise=lambda value: value) -> list[dict]:
	rows = frappe.get_all(
		VERSION,
		filters={"ref_doctype": doctype, "docname": name, "data": ["like", f'%"{fieldname}"%']},
		fields=["owner", "creation", "data"],
		order_by="creation asc",
	)
	changes = []
	for row in rows:
		try:
			changed = json.loads(row.data or "{}").get("changed") or []
		except ValueError:
			continue
		for field, old, new in (entry for entry in changed if len(entry) == 3):
			if field == fieldname and normalise(old) != normalise(new):
				changes.append(frappe._dict(at=row.creation, by=row.owner, old=old, new=new))
	return changes


def iban_updates(ctx: Context, employee: str) -> list[dict]:
	def load():
		rows = frappe.get_all(
			IBAN_UPDATE,
			filters={"employee": employee, "docstatus": 1},
			fields=["name", "iban", "modified", "modified_by", "owner"],
			order_by="modified desc",
		)
		readable = ctx.readable_names(IBAN_UPDATE, [row.name for row in rows])
		for row in rows:
			row.readable = row.name in readable
			row.submitter = submitter_of(row)
		return rows

	return ctx.remember(("iban_updates", employee), load)


def submitter_of(row) -> str:
	return (
		frappe.db.get_value(
			"Comment",
			{"reference_doctype": IBAN_UPDATE, "reference_name": row.name, "comment_type": "Workflow"},
			"owner",
			order_by="creation desc",
		)
		or row.modified_by
	)


def account_matches_employee(ctx: Context, account, employee: str | None, requester: str) -> Result:
	record = ctx.employee(employee, ("bank_ac_no",))
	shown = [
		evidence(_("Account on this record"), normalise_account(account)),
		evidence(_("Account on the employee record"), normalise_account(record.bank_ac_no), EMPLOYEE, record.name),
	]
	target = normalise_account(account)
	if target and target == normalise_account(record.bank_ac_no):
		return Result(PASS, _("The account matches the employee record; account ownership not verified."), shown)
	updates = iban_updates(ctx, record.name)
	same = [row for row in updates if row.readable and normalise_account(row.iban) == target]
	independent = [row for row in same if row.submitter not in (requester, ctx.user)]
	for row in same:
		shown.append(evidence(_("IBAN Update {0} submitted by {1} on {2}").format(row.name, row.submitter, getdate(row.modified)), row.iban, IBAN_UPDATE, row.name))
	if independent:
		return Result(PASS, _("The account matches a submitted IBAN Update by another user; account ownership not verified."), shown)
	if same:
		return Result(WARN, _("The account matches only an IBAN Update submitted by the requester or by you."), shown)
	if any(not row.readable for row in updates):
		return Result(WARN, _("The account differs from the employee record, and some IBAN Updates could not be read."), shown)
	return Result(WARN, _("The account differs from the employee record."), shown)


def account_changed_recently(ctx: Context, employee: str | None, anchor, requester: str) -> Result:
	record = ctx.employee(employee, ("bank_ac_no",))
	anchor = getdate(anchor)
	changes = field_changes(EMPLOYEE, record.name, "bank_ac_no", normalise_account)
	updates = [row for row in iban_updates(ctx, record.name) if row.readable]
	shown = []
	if changes:
		last = changes[-1]
		shown.append(evidence(_("Last bank account change"), _("{0} by {1}").format(getdate(last.at), last.by), EMPLOYEE, record.name))
	if updates:
		latest = updates[0]
		shown.append(evidence(_("Last IBAN Update"), _("{0} by {1}").format(getdate(latest.modified), latest.submitter), IBAN_UPDATE, latest.name))
	if not changes:
		return Result(PASS, _("No change to the employee bank account is recorded."), shown)
	by_party = [change for change in changes if change.by in (requester, ctx.user)]
	if by_party:
		return Result(WARN, _("The employee bank account was changed by the requester or by you."), shown)
	recent = [change for change in changes if getdate(change.at) >= anchor - RECENT_CHANGE]
	if recent:
		return Result(WARN, _("The employee bank account changed on {0}, within 30 days of {1}.").format(getdate(recent[-1].at), anchor), shown)
	return Result(PASS, _("The last bank account change is older than 30 days."), shown)


def fold_name(text) -> set[str]:
	folded = ARABIC_MARKS.sub("", str(text or "")).translate(ARABIC_FOLDS).lower()
	return set(NAME_TOKEN.findall(folded))


def name_matches(beneficiary, employee_name) -> bool:
	return len(fold_name(beneficiary) & fold_name(employee_name)) >= 2


def wage_matches_employee(ctx: Context) -> Result:
	doc = ctx.doc
	record = ctx.employee(doc.employee, ("basic_wage",))
	basic = flt(record.basic_wage)
	shown = [
		evidence(_("Total salary on this record"), flt(doc.total_salary)),
		evidence(_("Basic wage on the employee record"), basic, EMPLOYEE, record.name),
	]
	if all(record.meta.get_field(f) and record.has_permlevel_access_to(f) for f in ACTUAL_WAGE_FIELDS):
		actual = sum(flt(record.get(f)) for f in ACTUAL_WAGE_FIELDS)
		shown.append(evidence(_("Actual wage (basic, housing, other allowance)"), actual))
	shown.append(evidence(_("Note"), _("The law may base pay on the actual wage (Article 2); the current calculation uses the basic wage.")))
	if abs(flt(doc.total_salary) - basic) <= MONEY_TOLERANCE:
		return Result(PASS, _("Total salary matches the basic wage on the employee record."), shown)
	return Result(WARN, _("Total salary {0} differs from the basic wage {1} on the employee record.").format(flt(doc.total_salary), basic), shown)


def joining_matches_employee(ctx: Context) -> Result:
	doc = ctx.doc
	record = ctx.employee(doc.employee, ("date_of_joining",))
	shown = [
		evidence(_("Joining date on this record"), doc.date_1),
		evidence(_("Joining date on the employee record"), record.date_of_joining, EMPLOYEE, record.name),
	]
	if doc.date_1 and record.date_of_joining and getdate(doc.date_1) == getdate(record.date_of_joining):
		return Result(PASS, _("The joining date matches the employee record."), shown)
	return Result(WARN, _("The joining date differs from the employee record."), shown)


def stored_matches_recompute(ctx: Context, recompute, fields: tuple[str, ...]) -> Result:
	doc = ctx.doc
	copy = frappe.get_doc(doc.as_dict())
	recompute(copy)
	shown = []
	differ = []
	for fieldname in fields:
		stored, computed = flt(doc.get(fieldname)), flt(copy.get(fieldname))
		shown.append(evidence(doc.meta.get_label(fieldname), _("stored {0}, recalculated {1}").format(stored, computed)))
		if abs(stored - computed) > MONEY_TOLERANCE:
			differ.append(fieldname)
	if differ:
		return Result(WARN, _("Stored amounts differ from a fresh calculation; the record was edited or the calculation changed since it was saved."), shown)
	return Result(PASS, _("Stored amounts match a fresh calculation."), shown)


def counted_rows(doc) -> list:
	return [row for row in doc.get("cva") or [] if row.status != PAID and flt(row.amount3) > 0]


def row_days(row) -> int | None:
	if not (row.contract_start_date and row.contract_end_date):
		return None
	days = (getdate(row.contract_end_date) - getdate(row.contract_start_date)).days
	return 364 if days == 365 else days


def cva_row_amount_matches_formula(ctx: Context) -> Result:
	doc = ctx.doc
	rows = counted_rows(doc)
	if not rows:
		return Result(NA, _("No unpaid leave period is counted."))
	per_day = daily_wage(doc.total_salary)
	shown = []
	wrong = []
	for row in rows:
		days = row_days(row)
		expected = None if days is None else js_round(per_day * (days / 364 * flt(row.vad)))
		if expected is None or abs(flt(row.amount3) - expected) > MONEY_TOLERANCE:
			wrong.append(row)
			shown.append(evidence(_("Row {0}").format(row.idx), _("stored {0}, formula {1}").format(flt(row.amount3), expected)))
	if wrong:
		return Result(WARN, _("{0} leave period row(s) differ from the period formula.").format(len(wrong)), shown)
	return Result(PASS, _("Every counted leave period row matches the period formula."), shown)


def counted_periods_elsewhere(ctx: Context) -> list[dict]:
	doc = ctx.doc
	found = []
	for doctype in (ADVANCE_LEAVE_SALARY, END_OF_SERVICE):
		names = frappe.get_all(
			doctype,
			filters={"employee": doc.employee, "name": ["!=", doc.name], "workflow_state": ["in", SETTLED_STATES]},
			pluck="name",
		)
		if not names:
			continue
		readable = ctx.readable_names(doctype, names)
		rows = frappe.get_all(
			PERIOD_DOCTYPE,
			filters={"parenttype": doctype, "parentfield": "cva", "parent": ["in", names], "status": ["!=", PAID], "amount3": [">", 0]},
			fields=["parent", "contract_start_date", "contract_end_date", "amount3"],
		)
		for row in rows:
			row.doctype = doctype
			row.readable = row.parent in readable
			found.append(row)
	return found


def overlap_days(row, period) -> int:
	start = max(getdate(row.contract_start_date), getdate(period.contract_start_date))
	end = min(getdate(row.contract_end_date), getdate(period.contract_end_date))
	return (end - start).days


def period_already_settled(ctx: Context) -> Result:
	doc = ctx.doc
	if not doc.employee:
		raise Unverifiable(_("No employee is linked to this record."))
	rows = counted_rows(doc)
	if not rows:
		return Result(NA, _("No unpaid leave period is counted."))
	periods = counted_periods_elsewhere(ctx)
	clashes = [(row, period) for row in rows for period in periods if overlaps(row, period)]
	seen = [(row, period, overlap_days(row, period)) for row, period in clashes if period.readable]
	shown = [
		evidence(
			_("Row {0} overlaps {1} by {2} days").format(row.idx, period.parent, days),
			f"{period.contract_start_date} - {period.contract_end_date}",
			period.doctype,
			period.parent,
		)
		for row, period, days in seen
	]
	if seen:
		longest = max(days for _row, _period, days in seen)
		return Result(
			FAIL,
			_("{0} counted leave period(s) are already counted in another approved or paid record; the longest overlap is {1} days.").format(len({row.idx for row, _period, _days in seen}), longest),
			shown,
			severity=BLOCK if longest > BOUNDARY_OVERLAP_DAYS else WARNING,
		)
	if clashes:
		raise no_permission()
	return Result(PASS, _("No counted leave period is counted in another approved or paid record."))


def leave_days_entitlement(ctx: Context) -> Result:
	rows = counted_rows(ctx.doc)
	if not rows:
		return Result(NA, _("No unpaid leave period is counted."))
	short = [row for row in rows if flt(row.vad) < 21]
	if short:
		return Result(WARN, _("{0} row(s) count fewer than 21 leave days a year.").format(len(short)), [evidence(_("Row {0}").format(row.idx), row.vad) for row in short])
	return Result(PASS, _("Every counted row has at least 21 leave days a year."))


def period_not_before_joining(ctx: Context) -> Result:
	doc = ctx.doc
	rows = counted_rows(doc)
	if not rows:
		return Result(NA, _("No unpaid leave period is counted."))
	record = ctx.employee(doc.employee, ("date_of_joining",))
	joined = getdate(record.date_of_joining) if record.date_of_joining else None
	if not joined:
		raise Unverifiable(_("The employee record has no joining date."))
	early = [row for row in rows if row.contract_start_date and getdate(row.contract_start_date) < joined]
	shown = [evidence(_("Joining date on the employee record"), joined, EMPLOYEE, record.name)]
	if early:
		shown += [evidence(_("Row {0}").format(row.idx), row.contract_start_date) for row in early]
		return Result(WARN, _("{0} counted row(s) start before the employee joined.").format(len(early)), shown)
	return Result(PASS, _("No counted row starts before the employee joined."), shown)


def employee_active(ctx: Context) -> Result:
	record = ctx.employee(ctx.doc.employee, ("status",))
	shown = [evidence(_("Employee status"), record.status, EMPLOYEE, record.name)]
	if record.status == "Active":
		return Result(PASS, _("The employee is active."), shown)
	return Result(WARN, _("The employee status is {0}, not Active.").format(record.status), shown)


def ticket_only(doc) -> bool:
	return flt(doc.cva_total) == 0 and cint(doc.number_of_tickets) > 0

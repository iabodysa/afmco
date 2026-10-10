# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _, _lt
from frappe.utils import cint, cstr, flt, getdate, strip_html

from afmco.approver_check.attachments import (
	MISSING,
	READABLE,
	REMOTE,
	UNREADABLE,
	UNSUPPORTED,
	attached_files,
	extension,
	local_path,
	pdf_edit_signs,
	readability,
)
from afmco.approver_check.checks_common import (
	VERSION,
	account_changed_recently,
	account_matches_employee,
	account_sql,
	approver_not_requester,
	employee_links,
	employees_with_account,
	has_attachment,
	iban_result,
	name_matches,
)
from afmco.approver_check.model import (
	ACCOUNTING,
	AI,
	ATTACHMENTS,
	BENEFICIARY,
	BLOCK,
	EMPLOYEE,
	FAIL,
	FRAUD,
	INFO,
	NA,
	PASS,
	PAYMENT_REQUISITION,
	POLICY,
	UNKNOWN,
	WARN,
	WARNING,
	Check,
	Context,
	Result,
	Unverifiable,
	evidence,
	no_permission,
)
from afmco.people_and_payroll.advance_leave_salary import ADVANCE_LEAVE_SALARY, END_OF_SERVICE
from afmco.people_and_payroll.iban import normalise_account

EOS_TYPE = "EOS"
ALS_TYPE = "Advance Leave Salary"
LOAN_TYPE = "Employee Loan"
EMPLOYEE_TYPES = (EOS_TYPE, ALS_TYPE, LOAN_TYPE)
SOURCE_TYPES = {EOS_TYPE: END_OF_SERVICE, ALS_TYPE: ADVANCE_LEAVE_SALARY}
CLOSED_STATES = ("Rejected", "Cancelled")
SOURCE_DONE_STATES = ("Approved", "Paid")
BANK_MODES = ("Local Bank Transfer", "Intra-NCB Transfer", "Bank Transfer")
SNB_MODE = "Intra-NCB Transfer"
NOT_IBAN_TYPES = ("SADAD Payment", "Payroll (Salary)", "Passport Fee Payment", "Work Permit Fee Payment")
SADAD = "SADAD Payment"
INVOICE_TYPES = ("Purchases", "Expenses", "Due Amount", "Medical Insurance Bill Payment")
SUPPLIER_TYPES = ("Purchases", "Due Amount")
DUPLICATE_TYPES = (EOS_TYPE, ALS_TYPE, LOAN_TYPE, "Expenses", "Petty Cash", "Other Payment", "Due Amount", "Purchases")
COST_CENTER_EXEMPT_TYPES = ()
AUDIT_ROLES = ("Auditor", "General Manager", "Projects Manager")
APPROVAL_STEPS = (
	"Waiting P.M Approval",
	"Financial Controller",
	"Waiting Manager Approval",
	"Waiting Bank Entry",
	"First Approval for Bank",
	"Document Upload",
	"Waiting",
)
MIN_REMARK = 15
DUPLICATE_WINDOW = 14
RECURRING_GAP = (25, 35)
RECURRING_MIN = 3
SNB_ACCOUNT_DIGITS = 14


def reference(ctx: Context) -> str:
	return cstr(ctx.doc.tax_invoice_number).strip()


def latest_amendment(doctype: str, name: str) -> str:
	current, seen = name, {name}
	while True:
		amended = frappe.get_all(
			doctype,
			filters={"amended_from": current, "docstatus": ["<", 2]},
			pluck="name",
			order_by="creation desc",
			limit=1,
		)
		if not amended or amended[0] in seen:
			return current
		current = amended[0]
		seen.add(current)


def source(ctx: Context):
	def load():
		ref = reference(ctx)
		doctype = SOURCE_TYPES.get(ctx.doc.payment_type)
		if not ref:
			return None
		candidates = [doctype] if doctype else [END_OF_SERVICE, ADVANCE_LEAVE_SALARY]
		for candidate in candidates:
			if frappe.db.exists(candidate, ref):
				name = latest_amendment(candidate, ref)
				doc = frappe.get_doc(candidate, name)
				return frappe._dict(doctype=candidate, name=name, original=ref, doc=doc, readable=ctx.can_read(candidate, doc))
		return None

	return ctx.remember("source", load)


def readable_source(ctx: Context):
	found = source(ctx)
	if found is None:
		raise Unverifiable(_("The reference does not point to an EOS or leave salary record."))
	if not found.readable:
		raise no_permission()
	return found


def source_link(found) -> dict:
	return evidence(_("Source record"), f"{found.name} ({found.doc.workflow_state})", found.doctype, found.name)


def linked_employee(ctx: Context) -> str:
	if ctx.doc.payment_type == LOAN_TYPE:
		raise Unverifiable(_("An Employee Loan payment carries no employee link to compare against."))
	return readable_source(ctx).doc.employee


def reference_siblings(ctx: Context) -> tuple[list[dict], int]:
	def load():
		ref = reference(ctx)
		rows = frappe.get_all(
			PAYMENT_REQUISITION,
			filters={"tax_invoice_number": ref, "docstatus": ["<", 2], "workflow_state": ["not in", CLOSED_STATES]},
			fields=["name", "amount", "workflow_state"],
		)
		if ctx.doc.name not in {row.name for row in rows}:
			rows.append(frappe._dict(name=ctx.doc.name, amount=ctx.doc.amount, workflow_state=ctx.doc.workflow_state))
		readable = ctx.readable_names(PAYMENT_REQUISITION, [row.name for row in rows]) | {ctx.doc.name}
		return [row for row in rows if row.name in readable], len(rows) - len(readable & {row.name for row in rows})

	return ctx.remember("siblings", load)


def sibling_evidence(rows) -> list[dict]:
	return [evidence(_("Payment request"), f"{flt(row.amount)} ({row.workflow_state})", PAYMENT_REQUISITION, row.name) for row in rows]


def skipped_note(hidden: int) -> str:
	return _(" {0} related record(s) you cannot read were not counted.").format(hidden) if hidden else ""


def account_history(ctx: Context) -> tuple[list[dict], int]:
	def load():
		normalised = normalise_account(ctx.doc.account_no)
		if not normalised:
			return [], 0
		rows = frappe.db.sql(
			f"""select name, amount, date, creation, workflow_state, docstatus, beneficiary_name, payment_type
			from `tabPayment Requisition` where {account_sql("account_no")} = %s and name != %s""",
			(normalised, ctx.doc.name),
			as_dict=True,
		)
		readable = ctx.readable_names(PAYMENT_REQUISITION, [row.name for row in rows])
		return [row for row in rows if row.name in readable], len(rows) - len(readable)

	return ctx.remember("account_history", load)


def live(row) -> bool:
	return cint(row.docstatus) < 2 and row.workflow_state not in CLOSED_STATES


def amount_positive(ctx: Context) -> Result:
	amount = flt(ctx.doc.amount)
	if amount > 0:
		return Result(PASS, _("Amount is {0}.").format(amount))
	return Result(FAIL, _("Amount is {0}; a payment must be greater than zero.").format(amount))


def source_document_found(ctx: Context) -> Result:
	if ctx.doc.payment_type not in SOURCE_TYPES:
		return Result(NA, _("This payment type has no source record."))
	found = source(ctx)
	if found is None:
		return Result(WARN, _("The reference {0} does not point to an existing {1}.").format(reference(ctx) or "-", _(SOURCE_TYPES[ctx.doc.payment_type])))
	if found.doctype != SOURCE_TYPES[ctx.doc.payment_type]:
		return Result(WARN, _("The reference points to a {0}, not to the payment type's record.").format(_(found.doctype)))
	return Result(PASS, _("The reference points to {0}.").format(found.name), [evidence(_("Source record"), found.name, found.doctype, found.name)])


def source_document_state(ctx: Context) -> Result:
	if not reference(ctx) or source(ctx) is None:
		return Result(NA, _("No source record is linked."))
	found = readable_source(ctx)
	shown = [source_link(found)]
	if found.name != found.original:
		shown.append(evidence(_("Amended from"), found.original, found.doctype, found.original))
	if found.doc.workflow_state in SOURCE_DONE_STATES:
		return Result(PASS, _("The source record is {0}.").format(_(found.doc.workflow_state)), shown)
	return Result(WARN, _("The source record is {0}, not Approved or Paid.").format(_(found.doc.workflow_state or "-")), shown)


def amount_matches_source(ctx: Context) -> Result:
	if not reference(ctx) or source(ctx) is None:
		return Result(NA, _("No source record is linked."))
	found = readable_source(ctx)
	expected = flt(found.doc.amount)
	siblings, hidden = reference_siblings(ctx)
	total = sum(flt(row.amount) for row in siblings)
	shown = [source_link(found), evidence(_("Source amount"), expected)] + sibling_evidence(siblings)
	if abs(flt(ctx.doc.amount) - expected) <= 1:
		return Result(PASS, _("The amount matches the source record."), shown)
	if abs(total - expected) <= 1:
		return Result(PASS, _("Together with {0} other payment request(s) the amount matches the source record.").format(len(siblings) - 1), shown)
	return Result(WARN, (_("The amount {0} differs from the source amount {1}; all open requests on this reference total {2}.").format(flt(ctx.doc.amount), expected, total)) + skipped_note(hidden), shown)


def reference_overpaid(ctx: Context) -> Result:
	if not reference(ctx) or source(ctx) is None:
		return Result(NA, _("No source record is linked."))
	found = readable_source(ctx)
	expected = flt(found.doc.amount)
	siblings, hidden = reference_siblings(ctx)
	total = sum(flt(row.amount) for row in siblings)
	shown = [source_link(found), evidence(_("Source amount"), expected)] + sibling_evidence(siblings)
	if total > expected + 1:
		return Result(WARN, _("Payment requests on this reference total {0}, more than the source amount {1}.").format(total, expected) + skipped_note(hidden), shown)
	return Result(PASS, _("Payment requests on this reference total {0}, within the source amount.").format(total) + skipped_note(hidden), shown)


def cost_center_set(ctx: Context) -> Result:
	if ctx.doc.payment_type in COST_CENTER_EXEMPT_TYPES:
		return Result(NA, _("This payment type needs no cost center."))
	if ctx.doc.project:
		return Result(PASS, _("Cost center is {0}.").format(ctx.doc.project))
	return Result(WARN, _("No cost center is set."))


def remark_describes_purpose(ctx: Context) -> Result:
	remark = strip_html(cstr(ctx.doc.remark)).strip()
	if len(remark) >= MIN_REMARK:
		return Result(PASS, _("The remark describes the purpose."))
	return Result(WARN, _("The remark is shorter than {0} characters.").format(MIN_REMARK), [evidence(_("Remark"), remark or "-")])


def urgent_has_reason(ctx: Context) -> Result:
	if not cint(ctx.doc.if_it__urgent):
		return Result(NA, _("The request is not urgent."))
	reason = strip_html(cstr(ctx.doc.reason_of_urgency)).strip()
	if reason:
		return Result(PASS, _("Reason given; truth not verified."), [evidence(_("Reason of urgency"), reason)])
	return Result(WARN, _("The request is urgent and gives no reason."))


def already_paid_flag(ctx: Context) -> Result:
	if cint(ctx.doc.verify_payment):
		return Result(WARN, _("The request is marked Already paid."))
	return Result(PASS, _("The request is not marked Already paid."))


def attachment_present(ctx: Context) -> Result:
	return has_attachment(ctx, FAIL)


def attachment_readable(ctx: Context) -> Result:
	files = attached_files(ctx)
	if not files:
		return Result(NA, _("No file is attached."))
	states = {f.name: readability(f) for f in files}
	shown = [evidence(_("File"), f"{f.file_name}: {readability_label(states[f.name])}", "File", f.name) for f in files]
	if any(state in (MISSING, UNREADABLE) for state in states.values()):
		return Result(WARN, _("Some attached files are missing on the server or cannot be opened."), shown)
	if any(state == REMOTE for state in states.values()):
		return Result(UNKNOWN, _("Some attachments are web links and were not opened."), shown)
	return Result(PASS, _("Every attached file is on the server; PDFs and images open."), shown)


def readability_label(state: str) -> str:
	return {
		MISSING: _("missing on the server"),
		REMOTE: _("web link, not opened"),
		UNREADABLE: _("cannot be opened"),
		UNSUPPORTED: _("on the server, not a PDF or image"),
		READABLE: _("opens"),
	}[state]


def attachment_reused_elsewhere(ctx: Context) -> Result:
	hashes = {f.content_hash for f in attached_files(ctx) if f.content_hash}
	if not hashes:
		return Result(NA, _("No attached file carries a content fingerprint."))
	rows = frappe.get_all(
		"File",
		filters={"attached_to_doctype": PAYMENT_REQUISITION, "attached_to_name": ["!=", ctx.doc.name], "content_hash": ["in", list(hashes)]},
		fields=["attached_to_name", "file_name"],
	)
	others = {row.attached_to_name for row in rows}
	readable = ctx.readable_names(PAYMENT_REQUISITION, others)
	accounts = dict(frappe.get_all(PAYMENT_REQUISITION, filters={"name": ["in", list(readable)]}, fields=["name", "account_no"], as_list=True)) if readable else {}
	mine = normalise_account(ctx.doc.account_no)
	elsewhere = sorted(name for name, account in accounts.items() if normalise_account(account) != mine)
	note = skipped_note(len(others) - len(readable))
	if elsewhere:
		shown = [evidence(_("Same file on"), normalise_account(accounts[name]), PAYMENT_REQUISITION, name) for name in elsewhere[:20]]
		return Result(WARN, _("An attached file is also attached to {0} request(s) paying another account.").format(len(elsewhere)) + note, shown)
	return Result(PASS, _("No exact duplicate found.") + note)


def last_transition(doctype: str, name: str):
	rows = frappe.get_all(
		VERSION,
		filters={"ref_doctype": doctype, "docname": name, "data": ["like", '%"workflow_state"%']},
		fields=["creation", "owner", "data"],
		order_by="creation desc",
	)
	for row in rows:
		changed = json.loads(row.data or "{}").get("changed") or []
		if any(entry[0] == "workflow_state" for entry in changed if entry):
			return row
	return None


def files_added_after_approval(ctx: Context) -> Result:
	moved = last_transition(ctx.doc.doctype, ctx.doc.name)
	if moved is None:
		return Result(NA, _("The request has not moved through a workflow step yet."))
	late = [f for f in attached_files(ctx) if f.creation > moved.creation and f.owner != ctx.doc.owner]
	if late:
		shown = [evidence(_("File"), _("{0} by {1}").format(f.file_name, f.owner), "File", f.name) for f in late]
		return Result(WARN, _("{0} file(s) were added by someone other than the requester after the last workflow step.").format(len(late)), shown)
	return Result(PASS, _("No file was added by another user after the last workflow step."))


def pdf_metadata_edited(ctx: Context) -> Result:
	pdfs = [f for f in attached_files(ctx) if extension(f) == "pdf"]
	if not pdfs:
		return Result(NA, _("No PDF is attached."))
	shown, flagged, unread = [], 0, 0
	for f in pdfs:
		if readability(f) != READABLE:
			unread += 1
			continue
		signs = pdf_edit_signs(local_path(f))
		if signs:
			flagged += 1
			shown.append(evidence(f.file_name, "; ".join(signs), "File", f.name))
	if flagged:
		return Result(WARN, _("{0} PDF(s) show signs of editing after creation.").format(flagged), shown)
	if unread:
		return Result(UNKNOWN, _("{0} PDF(s) could not be opened.").format(unread), shown)
	return Result(PASS, _("No sign of editing found in the attached PDFs."), shown)


def zatca_qr_matches(ctx: Context) -> Result:
	if ctx.doc.payment_type not in INVOICE_TYPES:
		return Result(NA, _("This payment type carries no tax invoice."))
	return Result(UNKNOWN, _("QR reading is not enabled."))


def ai_document_suspicion(ctx: Context) -> Result:
	return Result(UNKNOWN, _("AI reading is not enabled."))


def iban_valid(ctx: Context) -> Result:
	doc = ctx.doc
	if doc.mode_of_payment not in BANK_MODES or doc.payment_type in NOT_IBAN_TYPES:
		return Result(NA, _("This payment mode or type does not pay a Saudi IBAN."))
	normalised = normalise_account(doc.account_no)
	if doc.mode_of_payment == SNB_MODE and normalised.isdigit() and len(normalised) == SNB_ACCOUNT_DIGITS:
		return Result(PASS, _("Local SNB account, not an IBAN."), [evidence(_("Account"), normalised)])
	return iban_result(doc.account_no)


def pr_account_matches_employee(ctx: Context) -> Result:
	if ctx.doc.payment_type not in EMPLOYEE_TYPES:
		return Result(NA, _("This payment type does not pay an employee."))
	found = source(ctx) if ctx.doc.payment_type != LOAN_TYPE else None
	if found and found.readable and found.doctype == END_OF_SERVICE and cint(found.doc.check3):
		return Result(NA, _("The settlement is paid in cash; see the settlement's own cash check."))
	return account_matches_employee(ctx, ctx.doc.account_no, linked_employee(ctx), ctx.doc.owner)


def pr_account_changed_recently(ctx: Context) -> Result:
	if ctx.doc.payment_type not in EMPLOYEE_TYPES:
		return Result(NA, _("This payment type does not pay an employee."))
	return account_changed_recently(ctx, linked_employee(ctx), ctx.doc.creation, ctx.doc.owner)


def beneficiary_name_present(ctx: Context) -> Result:
	if SADAD in (ctx.doc.payment_type, ctx.doc.mode_of_payment):
		return Result(NA, _("SADAD bills carry no beneficiary name."))
	if cstr(ctx.doc.beneficiary_name).strip():
		return Result(PASS, _("Beneficiary name is {0}.").format(ctx.doc.beneficiary_name))
	return Result(WARN, _("No beneficiary name is entered."))


def beneficiary_name_matches_employee(ctx: Context) -> Result:
	if ctx.doc.payment_type not in EMPLOYEE_TYPES:
		return Result(NA, _("This payment type does not pay an employee."))
	record = ctx.employee(linked_employee(ctx), ("employee_name",))
	shown = [
		evidence(_("Beneficiary name"), ctx.doc.beneficiary_name),
		evidence(_("Employee name"), record.employee_name, EMPLOYEE, record.name),
	]
	if name_matches(ctx.doc.beneficiary_name, record.employee_name):
		return Result(PASS, _("Name matches; account ownership not verified."), shown)
	return Result(WARN, _("The beneficiary name shares fewer than two names with the employee."), shown)


def account_history_check(ctx: Context) -> Result:
	if not normalise_account(ctx.doc.account_no):
		return Result(NA, _("No account number is entered."))
	rows, hidden = account_history(ctx)
	prior = [row for row in rows if live(row) and row.creation < ctx.doc.creation]
	note = skipped_note(hidden)
	if not prior:
		return Result(WARN, _("First payment to this account.") + note)
	first = min(getdate(row.date or row.creation) for row in prior)
	names = sorted({cstr(row.beneficiary_name).strip() for row in prior if cstr(row.beneficiary_name).strip()})
	shown = [evidence(_("Beneficiary name"), name) for name in names[:10]]
	return Result(PASS, _("{0} earlier payment(s) to this account since {1}; {2} beneficiary name(s).").format(len(prior), first, len(names)) + note, shown)


def account_is_employee_on_supplier_payment(ctx: Context) -> Result:
	if ctx.doc.payment_type not in SUPPLIER_TYPES:
		return Result(NA, _("Not a supplier payment."))
	owners = employees_with_account(ctx, ctx.doc.account_no)
	if owners:
		return Result(WARN, _("This supplier payment goes to an employee's own account."), employee_links(owners))
	return Result(PASS, _("The account is not an employee's account."))


def account_shared_by_employees(ctx: Context) -> Result:
	if not normalise_account(ctx.doc.account_no):
		return Result(NA, _("No account number is entered."))
	active = [row for row in employees_with_account(ctx, ctx.doc.account_no) if row.status == "Active"]
	if len(active) >= 2:
		return Result(WARN, _("{0} active employees share this account.").format(len(active)), employee_links(active))
	return Result(PASS, _("No two active employees share this account."))


def account_of_departed_employee(ctx: Context) -> Result:
	if ctx.doc.payment_type in SOURCE_TYPES or not normalise_account(ctx.doc.account_no):
		return Result(NA, _("Final dues go to a departed employee by design."))
	left = [row for row in employees_with_account(ctx, ctx.doc.account_no) if row.status == "Left"]
	if left:
		return Result(WARN, _("The account belongs to an employee who left."), employee_links(left))
	return Result(PASS, _("The account does not belong to an employee who left."))


def same_user_two_steps(ctx: Context) -> Result:
	rows = frappe.get_all(
		VERSION,
		filters={"ref_doctype": ctx.doc.doctype, "docname": ctx.doc.name, "owner": ctx.user, "data": ["like", '%"workflow_state"%']},
		fields=["creation", "data"],
		order_by="creation asc",
	)
	steps = []
	for row in rows:
		for entry in json.loads(row.data or "{}").get("changed") or []:
			if len(entry) == 3 and entry[0] == "workflow_state" and entry[1] in APPROVAL_STEPS:
				steps.append(evidence(_("Step you approved"), _("{0} on {1}").format(_(entry[1]), getdate(row.creation))))
	if steps:
		return Result(WARN, _("You already moved this request through an earlier approval step."), steps)
	return Result(PASS, _("You have not approved an earlier step of this request."))


def recurring(dates: list) -> bool:
	ordered = sorted(dates)
	gaps = [(later - earlier).days for earlier, later in zip(ordered, ordered[1:], strict=False)]
	return sum(1 for gap in gaps if RECURRING_GAP[0] <= gap <= RECURRING_GAP[1]) >= RECURRING_MIN


def duplicate_amount_account_14d(ctx: Context) -> Result:
	doc = ctx.doc
	if doc.payment_type not in DUPLICATE_TYPES:
		return Result(NA, _("This payment type is not checked for duplicates."))
	if not normalise_account(doc.account_no):
		return Result(NA, _("No account number is entered."))
	rows, hidden = account_history(ctx)
	day = getdate(doc.date or doc.creation)
	same = [row for row in rows if live(row) and abs(flt(row.amount) - flt(doc.amount)) < 0.01]
	near = [row for row in same if abs((getdate(row.date or row.creation) - day).days) <= DUPLICATE_WINDOW]
	note = skipped_note(hidden)
	if not near:
		return Result(PASS, _("No other request pays the same amount to this account within 14 days.") + note)
	shown = sibling_evidence(near)
	earlier = [getdate(row.date or row.creation) for row in same if getdate(row.date or row.creation) < day]
	if recurring(earlier + [day]):
		return Result(WARN, _("Same amount to the same account recurs monthly; recurring pattern.") + note, shown, severity=INFO)
	return Result(WARN, _("{0} other request(s) pay the same amount to this account within 14 days.").format(len(near)) + note, shown)


CHECKS = (
	Check("PR-ACC-01", "amount_positive", ACCOUNTING, _lt("Amount is greater than zero"), BLOCK, amount_positive),
	Check("PR-ACC-02", "source_document_found", ACCOUNTING, _lt("Reference points to an existing source record"), WARNING, source_document_found),
	Check("PR-ACC-03", "source_document_state", ACCOUNTING, _lt("Source record is approved"), WARNING, source_document_state),
	Check("PR-ACC-04", "amount_matches_source", ACCOUNTING, _lt("Amount matches the source record"), WARNING, amount_matches_source),
	Check("PR-ACC-05", "reference_overpaid", ACCOUNTING, _lt("Reference is not overpaid"), WARNING, reference_overpaid),
	Check("PR-ACC-06", "cost_center_set", ACCOUNTING, _lt("Cost center is set"), WARNING, cost_center_set),
	Check("PR-ACC-07", "remark_describes_purpose", ACCOUNTING, _lt("Remark describes the purpose"), WARNING, remark_describes_purpose),
	Check("PR-ACC-08", "urgent_has_reason", ACCOUNTING, _lt("Urgent request has a reason"), WARNING, urgent_has_reason),
	Check("PR-ACC-09", "already_paid_flag", ACCOUNTING, _lt("Already paid flag"), INFO, already_paid_flag),
	Check("PR-ATT-01", "has_attachment", ATTACHMENTS, _lt("Supporting file attached"), BLOCK, attachment_present),
	Check("PR-ATT-02", "attachment_readable", ATTACHMENTS, _lt("Attached files can be opened"), INFO, attachment_readable),
	Check("PR-ATT-03", "attachment_reused_elsewhere", ATTACHMENTS, _lt("Attachment not reused for another account"), INFO, attachment_reused_elsewhere),
	Check("PR-ATT-04", "files_added_after_approval", ATTACHMENTS, _lt("Files added after the last workflow step"), INFO, files_added_after_approval),
	Check("PR-ATT-05", "pdf_metadata_edited", ATTACHMENTS, _lt("PDF shows no sign of editing"), INFO, pdf_metadata_edited),
	Check("PR-ATT-06", "zatca_qr_matches", ATTACHMENTS, _lt("Invoice QR code matches"), WARNING, zatca_qr_matches),
	Check("PR-BEN-01", "iban_valid", BENEFICIARY, _lt("IBAN is valid"), BLOCK, iban_valid),
	Check("PR-BEN-02", "account_matches_employee", BENEFICIARY, _lt("Account matches the employee record"), WARNING, pr_account_matches_employee),
	Check("PR-BEN-03", "account_changed_recently", BENEFICIARY, _lt("Employee bank account not changed recently"), WARNING, pr_account_changed_recently),
	Check("PR-BEN-04", "beneficiary_name_present", BENEFICIARY, _lt("Beneficiary name is filled"), WARNING, beneficiary_name_present),
	Check("PR-BEN-05", "beneficiary_name_matches_employee", BENEFICIARY, _lt("Beneficiary name matches the employee"), INFO, beneficiary_name_matches_employee),
	Check("PR-BEN-06", "account_history", BENEFICIARY, _lt("Account payment history"), INFO, account_history_check),
	Check("PR-BEN-07", "account_is_employee_on_supplier_payment", BENEFICIARY, _lt("Supplier payment does not go to an employee"), INFO, account_is_employee_on_supplier_payment),
	Check("PR-BEN-08", "account_shared_by_employees", BENEFICIARY, _lt("Account not shared by several employees"), WARNING, account_shared_by_employees),
	Check("PR-BEN-09", "account_of_departed_employee", BENEFICIARY, _lt("Account not of an employee who left"), INFO, account_of_departed_employee),
	Check("PR-POL-01", "approver_not_requester", POLICY, _lt("Approver is not the requester"), WARNING, approver_not_requester),
	Check("PR-POL-02", "same_user_two_steps", POLICY, _lt("Approver did not approve an earlier step"), WARNING, same_user_two_steps),
	Check("PR-FRD-01", "duplicate_amount_account_14d", FRAUD, _lt("No duplicate payment within 14 days"), WARNING, duplicate_amount_account_14d),
	Check("PR-FRD-02", "ai_document_suspicion", FRAUD, _lt("AI reading of attachments"), WARNING, ai_document_suspicion, mode=AI),
)

ROLE_RESTRICTED = {"PR-BEN-06": AUDIT_ROLES}

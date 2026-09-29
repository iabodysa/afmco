# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from datetime import date

import frappe
from erpnext import get_default_company
from frappe import _
from frappe.model.workflow import get_workflow_name
from frappe.utils import (
	add_days,
	add_months,
	cint,
	cstr,
	flt,
	get_first_day,
	get_last_day,
	getdate,
	today,
)

GROUP = "SADAD Batch"
LINE = "SADAD Batch Item"
SETUP = "SADAD Setup"
PAYMENT_REQUEST = "Payment Requisition"
JOURNAL_ENTRY = "Journal Entry"
JOURNAL_ENTRY_ACCOUNT = "Journal Entry Account"
RENEWAL_TRACKING = "Iqama Renewal Tracking"
CONTEXT = "SADAD Bulk"
GROUP_SERIES = "SADAD-B-.YYYY.-"
PAYMENT_REQUEST_SERIES = "PR-.YYYY.-"
TYPE_PLACEHOLDER = "--- Select ---"
SINGLE_PERIOD_TYPE = "Change of profession"
RENEWAL_TYPE = "Issue or renew residence permit"
RENEWAL_CLOSED = ("Renewed", "Rejected")
BENEFICIARY = "Payment of MOI - Expatriates"
SADAD_PAYMENT = "SADAD Payment"
JV_CREATED = "JV Created"
JV_NOT_CREATED = "JV Not Created"
PAID_STATE = "Paid"
BANK_ACCOUNT_NUMBER = "122001"
HEAD_OFFICE_SUFFIX = " - Head Office - AF"
CSV_HEADER = "Biller,Service,Iqama ID,Iqama Duration in Years,Credit"
BLOCKING = frozenset({"unknown_employee", "duplicate_in_batch", "past_year", "no_account"})


@frappe.whitelist(methods=["GET"])
def get_setup():
	return [
		{
			"types_english": row.types_english,
			"types_arabic": row.types_arabic,
			"period": cint(row.period),
			"period_unit": row.period_unit,
			"biller": row.biller,
			"service_codes": row.service_codes,
			"amounts": flt(row.amounts, 2),
			"has_advanced_account": bool(row.advanced_expenses),
		}
		for row in _setup_rows()
	]


@frappe.whitelist(methods=["GET"])
def list_batches(docstatus=None, search=None, from_date=None, to_date=None, start=0, page_length=50):
	frappe.has_permission(GROUP, "read", throw=True)
	filters = []
	if cstr(docstatus) != "":
		filters.append(["docstatus", "=", cint(docstatus)])
	if from_date:
		filters.append(["creation", ">=", getdate(from_date)])
	if to_date:
		filters.append(["creation", "<", add_days(getdate(to_date), 1)])
	search = cstr(search).strip()
	if search:
		parents = set(
			frappe.get_all(
				LINE,
				filters={
					"parenttype": GROUP,
					"parentfield": "item",
					"employee": search,
				},
				pluck="parent",
			)
		)
		parents |= set(
			frappe.get_all(
				LINE,
				filters={
					"parenttype": GROUP,
					"parentfield": "item",
					"sadad_invoice_number": search,
				},
				pluck="parent",
			)
		)
		named = frappe.get_list(
			GROUP,
			filters=[["name", "like", f"%{search}%"]],
			pluck="name",
			limit_page_length=0,
		)
		filters.append(["name", "in", sorted(parents.union(named)) or [""]])
	rows = frappe.get_list(
		GROUP,
		filters=filters,
		fields=["name", "creation", "docstatus", "total_amount", "jv_status", "owner"],
		order_by="creation desc",
		limit_start=cint(start),
		limit_page_length=cint(page_length) or 50,
	)
	names = [row.name for row in rows]
	employees = {}
	for line in frappe.get_all(
		LINE,
		filters={
			"parenttype": GROUP,
			"parentfield": "item",
			"parent": ["in", names or [""]],
			"credit": [">", 0],
		},
		fields=["parent", "employee"],
	):
		employees.setdefault(line.parent, set()).add(line.employee)
	payment_requests = _linked(PAYMENT_REQUEST, "tax_invoice_number", names, ["workflow_state"])
	journal_entries = _linked(JOURNAL_ENTRY, "user_remark", names, [])
	for row in rows:
		row.employees = len(employees.get(row.name, ()))
		row.payment_requests = None if payment_requests is None else payment_requests.get(row.name, [])
		row.journal_entries = None if journal_entries is None else journal_entries.get(row.name, [])
		row.state = _state(row.docstatus, row.payment_requests, row.journal_entries)
	return {"rows": rows, "start": cint(start), "page_length": cint(page_length) or 50}


@frappe.whitelist(methods=["GET"])
def get_batch(name):
	doc = frappe.get_doc(GROUP, name)
	doc.check_permission("read")
	groups = {}
	for row in doc.get("item"):
		key = (row.employee, row.type)
		group = groups.setdefault(
			key,
			{
				"employee": row.employee,
				"employee_name": row.employee_name,
				"cost_center": row.cost_center,
				"type": row.type,
				"types_arabic": row.types_arabic,
				"period": row.period,
				"biller": row.biller,
				"service_codes": row.service_codes,
				"debit": 0.0,
				"credit": 0.0,
				"sadad_invoice_number": None,
				"segments": [],
				"bank_account": None,
			},
		)
		if flt(row.credit):
			group["credit"] = flt(group["credit"] + flt(row.credit), 2)
			group["sadad_invoice_number"] = row.sadad_invoice_number or group["sadad_invoice_number"]
			group["bank_account"] = row.account
		if flt(row.debit):
			group["debit"] = flt(group["debit"] + flt(row.debit), 2)
			group["segments"].append(
				{
					"date": row.date,
					"enddate": row.enddate,
					"year": row.year,
					"debit": flt(row.debit, 2),
					"account": row.account,
				}
			)
	for group in groups.values():
		group["balanced"] = group["debit"] == group["credit"]
		group["missing_account"] = not group["bank_account"] or any(
			not s["account"] for s in group["segments"]
		)
	legacy = frappe.get_all(
		JOURNAL_ENTRY_ACCOUNT,
		filters={"parenttype": GROUP, "parent": doc.name},
		fields=[
			"parentfield",
			"account",
			"cost_center",
			"debit_in_account_currency",
			"credit_in_account_currency",
		],
		order_by="idx asc",
	)
	payment_requests = _linked(
		PAYMENT_REQUEST, "tax_invoice_number", [doc.name], ["workflow_state", "jv_status"]
	)
	journal_entries = _linked(JOURNAL_ENTRY, "user_remark", [doc.name], [])
	prs = None if payment_requests is None else payment_requests.get(doc.name, [])
	jes = None if journal_entries is None else journal_entries.get(doc.name, [])
	debit, credit = _totals(doc)
	has_credit = credit > 0
	return {
		"name": doc.name,
		"docstatus": doc.docstatus,
		"creation": doc.creation,
		"owner": doc.owner,
		"type": doc.type,
		"total_amount": flt(doc.total_amount, 2),
		"jv_status": doc.jv_status,
		"sadad_invoice_number": doc.sadad_invoice_number,
		"debit": debit,
		"credit": credit,
		"balanced": debit == credit,
		"groups": list(groups.values()),
		"legacy": legacy,
		"payment_requests": prs,
		"journal_entries": jes,
		"state": _state(doc.docstatus, prs, jes),
		"actions": {
			"csv": has_credit,
			"payment_request": doc.docstatus < 2
			and has_credit
			and prs == []
			and frappe.has_permission(PAYMENT_REQUEST, "create"),
			"submit": doc.docstatus == 0 and has_credit and bool(frappe.has_permission(GROUP, "submit", doc)),
			"journal_entry": doc.docstatus == 1
			and jes == []
			and prs is not None
			and len(prs) == 1
			and prs[0].docstatus == 1
			and prs[0].jv_status != JV_CREATED
			and frappe.has_permission(JOURNAL_ENTRY, "create"),
			"edit": doc.docstatus == 0 and bool(frappe.has_permission(GROUP, "write", doc)),
			"cancel": (doc.docstatus == 1 or bool(prs) or bool(jes))
			and doc.docstatus < 2
			and bool(frappe.has_permission(GROUP, "cancel" if doc.docstatus == 1 else "write", doc)),
		},
	}


@frappe.whitelist(methods=["POST"])
def preview_lines(
	fee_type,
	period,
	bank_payment_date,
	employees,
	sadad_invoice_number=None,
	batch=None,
):
	if batch:
		doc = frappe.get_doc(GROUP, batch)
		doc.check_permission("write")
		pairs = _pairs(doc)
	else:
		frappe.has_permission(GROUP, "create", throw=True)
		pairs = set()
	return _compose(
		fee_type,
		period,
		bank_payment_date,
		employees,
		sadad_invoice_number,
		pairs,
		batch,
	)


@frappe.whitelist(methods=["POST"])
def add_lines(
	fee_type,
	period,
	bank_payment_date,
	employees,
	sadad_invoice_number=None,
	batch=None,
):
	if batch:
		doc = _locked(batch, "write", 0)
	else:
		frappe.has_permission(GROUP, "create", throw=True)
		doc = frappe.new_doc(GROUP)
		doc.naming_series = GROUP_SERIES
		doc.type = TYPE_PLACEHOLDER
		doc.jv_status = JV_NOT_CREATED
	result = _compose(
		fee_type,
		period,
		bank_payment_date,
		employees,
		sadad_invoice_number,
		_pairs(doc),
		batch,
	)
	blocking = [issue for issue in result["issues"] if issue["blocking"]]
	if blocking:
		frappe.throw(
			"<br>".join(f"{frappe.bold(issue['employee'])}: {issue['message']}" for issue in blocking),
			title=_("Lines not added", context=CONTEXT),
		)
	if not result["lines"]:
		frappe.throw(_("No employee lines to add.", context=CONTEXT))
	for line in result["lines"]:
		doc.append("item", line)
	doc.total_amount = _totals(doc)[1]
	doc.save()
	return {
		"name": doc.name,
		"employees": result["employees"],
		"total": result["total"],
	}


@frappe.whitelist(methods=["POST"])
def remove_line_group(batch, employee, fee_type):
	doc = _locked(batch, "write", 0)
	keep = [row for row in doc.get("item") if (row.employee, row.type) != (employee, fee_type)]
	if len(keep) == len(doc.get("item")):
		frappe.throw(
			_("Employee {0} has no {1} lines in this batch.", context=CONTEXT).format(employee, fee_type)
		)
	doc.set("item", keep)
	doc.total_amount = _totals(doc)[1]
	doc.save()
	return {"name": doc.name}


@frappe.whitelist(methods=["GET"])
def bank_csv(batch):
	doc = frappe.get_doc(GROUP, batch)
	doc.check_permission("read")
	rows = [row for row in doc.get("item") if flt(row.credit) > 0]
	if not rows:
		frappe.throw(_("No data with credit to export", context=CONTEXT))
	lines = [CSV_HEADER]
	lines.extend(
		",".join(
			(
				cstr(row.biller),
				cstr(row.service_codes),
				cstr(row.employee),
				cstr(row.period),
				_plain_number(row.credit),
			)
		)
		for row in rows
	)
	return {"filename": f"{doc.name}-Bank.csv", "content": "\n".join(lines) + "\n"}


@frappe.whitelist(methods=["POST"])
def create_payment_request(batch):
	frappe.has_permission(PAYMENT_REQUEST, "create", throw=True)
	doc = _locked(batch, "read")
	if doc.docstatus == 2:
		frappe.throw(_("Batch {0} is cancelled.", context=CONTEXT).format(doc.name))
	existing = frappe.db.get_value(
		PAYMENT_REQUEST,
		{"tax_invoice_number": doc.name, "docstatus": ["<", 2]},
		"name",
		for_update=True,
	)
	if existing:
		return {"name": existing, "existing": True}
	rows = [row for row in doc.get("item") if flt(row.credit) > 0]
	if not rows:
		frappe.throw(_("No data with credit to export", context=CONTEXT))
	head_office = _head_office_cost_center(_company())
	payment_request = frappe.get_doc(
		{
			"doctype": PAYMENT_REQUEST,
			"naming_series": PAYMENT_REQUEST_SERIES,
			"tax_invoice_number": doc.name,
			"account_no": _invoice_number(doc, rows),
			"beneficiary_name": BENEFICIARY,
			"amount": _totals(doc)[1],
			"remark": "".join(_payment_request_remark(row) for row in rows),
			"mode_of_payment": SADAD_PAYMENT,
			"payment_type": SADAD_PAYMENT,
			"jv_status": JV_NOT_CREATED,
			"date": today(),
			"bank_payment_date": today(),
			"project": head_office,
			"cost_center": head_office,
		}
	)
	payment_request.insert()
	return {"name": payment_request.name, "existing": False}


@frappe.whitelist(methods=["POST"])
def submit_batch(batch):
	doc = _locked(batch, "submit", 0)
	if not doc.get("item"):
		frappe.throw(_("The batch has no lines.", context=CONTEXT))
	missing = [cstr(row.idx) for row in doc.get("item") if not row.account]
	if missing:
		frappe.throw(_("Rows without an account: {0}", context=CONTEXT).format(", ".join(missing)))
	sums = {}
	for row in doc.get("item"):
		entry = sums.setdefault((row.employee, row.type), [0.0, 0.0])
		entry[0] = flt(entry[0] + flt(row.debit), 2)
		entry[1] = flt(entry[1] + flt(row.credit), 2)
	unbalanced = [f"{employee} ({fee_type})" for (employee, fee_type), (d, c) in sums.items() if d != c]
	if unbalanced:
		frappe.throw(_("Debit does not equal credit for: {0}", context=CONTEXT).format(", ".join(unbalanced)))
	doc.total_amount = _totals(doc)[1]
	doc.jv_status = JV_CREATED
	doc.submit()
	return {"name": doc.name}


@frappe.whitelist(methods=["POST"])
def create_journal_entry(batch):
	frappe.has_permission(JOURNAL_ENTRY, "create", throw=True)
	doc = _locked(batch, "read", 1)
	payment_requests = frappe.get_all(
		PAYMENT_REQUEST,
		filters={"tax_invoice_number": doc.name, "docstatus": ["<", 2]},
		fields=["name", "docstatus", "jv_status"],
	)
	if len(payment_requests) != 1:
		frappe.throw(
			_("Batch {0} needs exactly one payment request; found {1}.", context=CONTEXT).format(
				doc.name, len(payment_requests)
			)
		)
	payment_request = payment_requests[0]
	existing = frappe.db.get_value(
		JOURNAL_ENTRY,
		{"expense_request_cf": payment_request.name, "docstatus": ["<", 2]},
		"name",
		for_update=True,
	)
	if existing:
		return {"name": existing, "existing": True}
	if payment_request.docstatus != 1:
		frappe.throw(
			_(
				"Payment request {0} must be submitted through its approval before its journal entry.",
				context=CONTEXT,
			).format(payment_request.name)
		)
	if payment_request.jv_status == JV_CREATED:
		frappe.throw(
			_("Payment request {0} already records a journal entry.", context=CONTEXT).format(
				payment_request.name
			)
		)
	company = _company()
	bank_gl = _bank_gl_account(company)
	bank_accounts = frappe.get_all(
		"Bank Account",
		filters={"account": bank_gl, "is_company_account": 1},
		pluck="name",
	)
	accounts = []
	for row in doc.get("item"):
		if not flt(row.debit) and not flt(row.credit):
			continue
		entry = {
			"account": row.account,
			"debit_in_account_currency": flt(row.debit, 2),
			"credit_in_account_currency": flt(row.credit, 2),
			"user_remark": _journal_remark(row),
		}
		if flt(row.debit):
			entry["employee"] = row.employee
			if row.cost_center:
				entry["cost_center"] = row.cost_center
		if row.account == bank_gl and len(bank_accounts) == 1:
			entry["bank_account"] = bank_accounts[0]
		accounts.append(entry)
	journal_entry = frappe.get_doc(
		{
			"doctype": JOURNAL_ENTRY,
			"voucher_type": "Journal Entry",
			"company": company,
			"posting_date": today(),
			"user_remark": doc.name,
			"expense_request_cf": payment_request.name,
			"accounts": accounts,
		}
	)
	journal_entry.insert()
	return {"name": journal_entry.name, "existing": False}


@frappe.whitelist(methods=["POST"])
def cancel_batch(batch):
	doc = _locked(batch, "read")
	if doc.docstatus == 2:
		frappe.throw(_("Batch {0} is cancelled.", context=CONTEXT).format(doc.name))
	doc.check_permission("cancel" if doc.docstatus == 1 else "write")
	payment_requests = frappe.get_all(
		PAYMENT_REQUEST,
		filters={"tax_invoice_number": doc.name, "docstatus": ["<", 2]},
		fields=["name", "docstatus"],
	)
	journal_entries = frappe.get_all(
		JOURNAL_ENTRY,
		filters={"user_remark": doc.name, "docstatus": ["<", 2]},
		pluck="name",
		order_by="name asc",
	)
	documents = [_reverse(JOURNAL_ENTRY, name) for name in journal_entries]
	for row in payment_requests:
		if row.docstatus == 0:
			documents.append(_reverse(PAYMENT_REQUEST, row.name))
		else:
			documents.append({"doctype": PAYMENT_REQUEST, "name": row.name, "result": "kept"})
	if doc.docstatus == 1:
		if get_workflow_name(GROUP):
			frappe.throw(_("Cancel {0} {1} through its workflow.", context=CONTEXT).format(GROUP, doc.name))
		doc.cancel()
	return {"name": doc.name, "docstatus": doc.docstatus, "documents": documents}


@frappe.whitelist(methods=["GET"])
def overview():
	frappe.has_permission(GROUP, "read", throw=True)
	drafts = frappe.get_list(GROUP, filters={"docstatus": 0}, fields=["total_amount"], limit_page_length=0)
	submitted = frappe.get_list(
		GROUP,
		filters={"docstatus": 1},
		fields=["name", "creation", "total_amount"],
		order_by="creation desc",
		limit_page_length=0,
	)
	journal_entries = _linked(JOURNAL_ENTRY, "user_remark", [row.name for row in submitted], [])
	queue = (
		None if journal_entries is None else [row for row in submitted if not journal_entries.get(row.name)]
	)
	paid = None
	if frappe.has_permission(PAYMENT_REQUEST, "read"):
		paid = len(
			frappe.get_list(
				PAYMENT_REQUEST,
				filters={
					"payment_type": SADAD_PAYMENT,
					"workflow_state": PAID_STATE,
					"date": [
						"between",
						[get_first_day(today()), get_last_day(today())],
					],
				},
				pluck="name",
				limit_page_length=0,
			)
		)
	return {
		"open_drafts": len(drafts),
		"pending_credit": flt(sum(flt(row.total_amount) for row in drafts), 2),
		"submitted_without_je": None if queue is None else len(queue),
		"paid_this_month": paid,
		"queue": None if queue is None else queue[:20],
	}


def _setup_rows():
	frappe.has_permission(SETUP, "read", throw=True)
	return frappe.get_single(SETUP).get("sadad_type") or []


def _compose(fee_type, period, bank_payment_date, employees, sadad_invoice_number, pairs, batch):
	if not fee_type or not bank_payment_date:
		frappe.throw(_("Please set type, period and bank payment date first.", context=CONTEXT))
	period = 1 if fee_type == SINGLE_PERIOD_TYPE else cint(period)
	matches = [row for row in _setup_rows() if row.types_english == fee_type and cint(row.period) == period]
	if len(matches) != 1:
		frappe.throw(
			_(
				"SADAD Setup holds {0} rows for {1} with period {2}; exactly one is required.",
				context=CONTEXT,
			).format(len(matches), fee_type, period)
		)
	setup = matches[0]
	ids, repeated = _parse_ids(employees)
	if not ids:
		frappe.throw(_("No data in employeelist.", context=CONTEXT))
	company = _company()
	head_office = _head_office_cost_center(company)
	bank_gl = _bank_gl_account(company)
	start = getdate(bank_payment_date)
	end = getdate(add_months(start, period))
	current_year = getdate(today()).year
	amount = flt(setup.amounts, 2)
	invoice = cstr(sadad_invoice_number).strip() or None
	known = {
		row.name: row
		for row in frappe.get_all(
			"Employee",
			filters={"name": ["in", ids]},
			fields=["name", "employee_name", "payroll_cost_center"],
		)
	}
	elsewhere = _open_elsewhere(ids, fee_type, batch)
	renewals = _open_renewals(ids) if fee_type == RENEWAL_TYPE else {}
	issues = []
	lines = []
	added = 0

	def issue(employee, code, message):
		issues.append(
			{
				"employee": employee,
				"code": code,
				"blocking": code in BLOCKING,
				"message": message,
			}
		)

	for employee in repeated:
		issue(
			employee,
			"repeated",
			_("Listed more than once; added once.", context=CONTEXT),
		)
	if renewals is None:
		issue(
			"",
			"renewal_check_skipped",
			_("No read access to Iqama Renewal Tracking.", context=CONTEXT),
		)
	for employee in ids:
		record = known.get(employee)
		if not record:
			issue(employee, "unknown_employee", _("Employee not found.", context=CONTEXT))
			continue
		if (employee, fee_type) in pairs:
			issue(
				employee,
				"duplicate_in_batch",
				_("Already has {0} lines in this batch.", context=CONTEXT).format(fee_type),
			)
			continue
		if elsewhere.get(employee):
			issue(
				employee,
				"open_elsewhere",
				_("Also in open draft {0}.", context=CONTEXT).format(", ".join(sorted(elsewhere[employee]))),
			)
		if renewals and renewals.get(employee):
			issue(
				employee,
				"open_renewal",
				_("Open iqama renewal {0}.", context=CONTEXT).format(", ".join(renewals[employee])),
			)
		cost_center = record.payroll_cost_center
		if not cost_center:
			issue(
				employee,
				"no_cost_center",
				_("Employee has no payroll cost center.", context=CONTEXT),
			)
		if not setup.biller or not setup.service_codes:
			issue(
				employee,
				"not_in_bank_file",
				_(
					"No biller or service code; excluded from the bank file.",
					context=CONTEXT,
				),
			)
		common = {
			"employee": employee,
			"employee_name": record.employee_name,
			"cost_center": cost_center,
			"type": fee_type,
			"types_arabic": setup.types_arabic,
			"period": cstr(period),
			"biller": setup.biller,
			"service_codes": setup.service_codes,
		}
		segments = _segments(start, end, amount)
		if any(segment_start.year < current_year for segment_start, _end, _share in segments):
			issue(
				employee,
				"past_year",
				_("A segment falls in a past year.", context=CONTEXT),
			)
		for segment_start, segment_end, share in segments:
			year = segment_start.year
			if year > current_year:
				account = setup.advanced_expenses
			elif cost_center == head_office:
				account = setup.account_head_office
			else:
				account = setup.account_other
			if year >= current_year and not account:
				issue(
					employee,
					"no_account",
					_("SADAD Setup has no account for {0}.", context=CONTEXT).format(year),
				)
			lines.append(
				dict(
					common,
					date=segment_start,
					enddate=segment_end,
					year=cstr(year),
					debit=share,
					credit=0,
					account=account if year >= current_year else None,
				)
			)
		lines.append(
			dict(
				common,
				date=start,
				enddate=end,
				year=cstr(start.year),
				debit=0,
				credit=amount,
				account=bank_gl,
				sadad_invoice_number=invoice,
			)
		)
		added += 1
	return {
		"setup": {
			"type": fee_type,
			"types_arabic": setup.types_arabic,
			"period": period,
			"period_unit": setup.period_unit,
			"amount": amount,
			"biller": setup.biller,
			"service_codes": setup.service_codes,
		},
		"start": start,
		"end": end,
		"lines": lines,
		"issues": issues,
		"employees": added,
		"total": flt(amount * added, 2),
		"blocking": any(item["blocking"] for item in issues),
	}


def _segments(start, end, amount):
	total = (end - start).days
	if end.year == start.year or total <= 0:
		return [(start, end, amount)]
	spans = []
	cursor = start
	while cursor < end:
		next_year = date(cursor.year + 1, 1, 1)
		spans.append(
			(
				cursor,
				min(date(cursor.year, 12, 31), end),
				(min(next_year, end) - cursor).days,
			)
		)
		cursor = next_year
	segments = []
	allocated = 0.0
	for index, (segment_start, segment_end, days) in enumerate(spans):
		share = flt(amount - allocated, 2) if index == len(spans) - 1 else flt(amount * days / total, 2)
		allocated = flt(allocated + share, 2)
		segments.append((segment_start, segment_end, share))
	return segments


def _parse_ids(employees):
	seen = set()
	ids = []
	repeated = []
	for raw in cstr(employees).splitlines():
		value = raw.strip()
		if not value:
			continue
		if value in seen:
			repeated.append(value)
			continue
		seen.add(value)
		ids.append(value)
	return ids, repeated


def _pairs(doc):
	return {(row.employee, row.type) for row in doc.get("item")}


def _open_elsewhere(ids, fee_type, batch):
	parents = {}
	for row in frappe.get_all(
		LINE,
		filters={
			"parenttype": GROUP,
			"parentfield": "item",
			"employee": ["in", ids],
			"type": fee_type,
		},
		fields=["parent", "employee"],
	):
		if row.parent != batch:
			parents.setdefault(row.parent, set()).add(row.employee)
	if not parents:
		return {}
	drafts = frappe.get_list(
		GROUP,
		filters={"name": ["in", list(parents)], "docstatus": 0},
		pluck="name",
		limit_page_length=0,
	)
	found = {}
	for name in drafts:
		for employee in parents[name]:
			found.setdefault(employee, set()).add(name)
	return found


def _open_renewals(ids):
	if not frappe.has_permission(RENEWAL_TRACKING, "read"):
		return None
	found = {}
	for row in frappe.get_list(
		RENEWAL_TRACKING,
		filters={"employee": ["in", ids], "status": ["not in", RENEWAL_CLOSED]},
		fields=["name", "employee"],
		limit_page_length=0,
	):
		found.setdefault(row.employee, []).append(row.name)
	return found


def _locked(batch, ptype, docstatus=None):
	latest = frappe.db.get_value(GROUP, batch, ["modified", "docstatus"], as_dict=True, for_update=True)
	if not latest:
		frappe.throw(
			_("Batch {0} not found.", context=CONTEXT).format(batch),
			frappe.DoesNotExistError,
		)
	doc = frappe.get_doc(GROUP, batch)
	doc.check_permission(ptype)
	if cstr(doc.modified) != cstr(latest.modified):
		frappe.throw(
			_(
				"Batch {0} changed in another session. Reload and try again.",
				context=CONTEXT,
			).format(batch)
		)
	if docstatus is not None and doc.docstatus != docstatus:
		frappe.throw(_("Batch {0} is not in the state this action needs.", context=CONTEXT).format(batch))
	return doc


def _linked(doctype, fieldname, names, fields):
	if not names or not frappe.has_permission(doctype, "read"):
		return None
	found = {}
	for row in frappe.get_list(
		doctype,
		filters={fieldname: ["in", names], "docstatus": ["<", 2]},
		fields=["name", "docstatus", fieldname, *fields],
		limit_page_length=0,
	):
		found.setdefault(row.get(fieldname), []).append(row)
	return found


def _reverse(doctype, name):
	record = frappe.get_doc(doctype, name)
	if record.docstatus == 0:
		frappe.delete_doc(doctype, name)
		return {"doctype": doctype, "name": name, "result": "deleted"}
	if get_workflow_name(doctype):
		frappe.throw(_("Cancel {0} {1} through its workflow.", context=CONTEXT).format(doctype, name))
	record.cancel()
	return {"doctype": doctype, "name": name, "result": "cancelled"}


def _state(docstatus, payment_requests, journal_entries):
	if docstatus == 2:
		return "cancelled"
	if journal_entries:
		return "journal_entry"
	if payment_requests:
		return "payment_request"
	return "submitted" if docstatus == 1 else "draft"


def _totals(doc):
	debit = flt(sum(flt(row.debit) for row in doc.get("item")), 2)
	credit = flt(sum(flt(row.credit) for row in doc.get("item")), 2)
	return debit, credit


def _company():
	company = get_default_company()
	if not company:
		frappe.throw(_("Set a default company first.", context=CONTEXT))
	return company


def _only(doctype, filters, label):
	names = frappe.get_all(doctype, filters=filters, pluck="name")
	if len(names) != 1:
		frappe.throw(
			_("Expected exactly one {0} for {1}; found {2}.", context=CONTEXT).format(
				doctype, label, len(names)
			)
		)
	return names[0]


def _bank_gl_account(company):
	return _only(
		"Account",
		{"account_number": BANK_ACCOUNT_NUMBER, "company": company, "is_group": 0},
		BANK_ACCOUNT_NUMBER,
	)


def _head_office_cost_center(company):
	return _only(
		"Cost Center",
		{"name": ["like", f"%{HEAD_OFFICE_SUFFIX}"], "company": company, "is_group": 0},
		HEAD_OFFICE_SUFFIX,
	)


def _invoice_number(doc, rows):
	numbers = {cstr(row.sadad_invoice_number).strip() for row in rows} - {""}
	if len(numbers) == 1:
		return numbers.pop()
	if cint(doc.sadad_invoice_number):
		return cstr(doc.sadad_invoice_number)
	frappe.throw(
		_(
			"The batch needs exactly one SADAD invoice number; found {0}.",
			context=CONTEXT,
		).format(len(numbers))
	)


def _payment_request_remark(row):
	parts = [
		("Employee", row.employee),
		("Employee Name", row.employee_name),
		("Type", row.types_arabic),
		("Period", row.period),
		("Amount", _plain_number(row.credit)),
		("Cost Center", row.cost_center),
		("Invoice Number", row.sadad_invoice_number),
	]
	return "".join(f"{label}: {value}\n" for label, value in parts if value) + "------------------------\n"


def _journal_remark(row):
	remark = f"Type: {row.type}\nID: {row.employee}\nArabic Type: {row.types_arabic}\n"
	if row.sadad_invoice_number:
		remark += f"Invoice Number: {row.sadad_invoice_number}\n"
	return remark


def _plain_number(value):
	value = flt(value)
	return cstr(int(value)) if value == int(value) else repr(value)

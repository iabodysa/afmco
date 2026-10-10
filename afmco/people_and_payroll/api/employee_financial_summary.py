# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.query_builder.functions import Replace, Upper
from frappe.utils import cint, date_diff, flt, getdate

from afmco.people_and_payroll.advance_leave_salary import daily_wage, service_years, settlement_award

PAGE_SIZE = 5
EOS_REASON = "1-End of term or mutual agreement"
EMPLOYEE_FIELDS = [
	"name",
	"employee_name",
	"designation",
	"department",
	"branch",
	"status",
	"date_of_joining",
	"relieving_date",
]
STRUCTURE_FIELDS = [
	"name",
	"salary_structure",
	"from_date",
	"base",
	"housing",
	"custom_housing",
	"transportation_allowance",
	"food_allowance",
	"supervisor_allowance",
	"attendance_allowance",
]
SLIP_FIELDS = ["name", "start_date", "gross_pay", "total_deduction", "net_pay"]
SLIP_DETAIL_FIELDS = ["parentfield", "salary_component", "amount"]
LOAN_FIELDS = [
	"name",
	"posting_date",
	"status",
	"loan_amount",
	"disbursed_amount",
	"total_principal_paid",
]
ADVANCE_FIELDS = [
	"name",
	"posting_date",
	"status",
	"advance_amount",
	"paid_amount",
	"claimed_amount",
	"return_amount",
]
EOS_FIELDS = ["total_salary", "salary_per_day", "total_eos"]
EOS_RECORD_FIELDS = [
	"name",
	"date_1",
	"date_2",
	"total_eos",
	"amount",
	"workflow_state",
	"end_of_service_reason",
]
VACATION_FIELDS = ["name", "date_1", "date_2", "amount", "workflow_state"]
LEAVE_FIELDS = ["leave_type", "leaves", "to_date", "is_expired"]
LEDGER_FIELDS = ["account", "debit", "credit", "party_type", "party", "is_cancelled"]
REQUISITION_FIELDS = ["name", "date", "amount", "workflow_state", "account_no"]
SOURCE_FIELDS = [
	"name",
	"date_of_joining",
	"relieving_date",
	"basic_wage",
	"iban",
	"bank_ac_no",
]


@frappe.whitelist()
def get_employee_financial_summary(employee, section=None, offset=0):
	frappe.only_for("HR Manager")
	frappe.has_permission("Employee Financial Summary", "read", throw=True)
	if not frappe.db.exists("Employee", employee):
		frappe.throw(_("Employee {0} not found").format(employee), frappe.DoesNotExistError)
	frappe.has_permission("Employee", "read", employee, throw=True)
	source = read_source(employee)
	if section:
		if section not in SECTIONS or not SECTIONS[section][2]:
			frappe.throw(_("Unknown section {0}").format(section))
		return {section: build_section(section, source, max(cint(offset), 0))}
	summary = {"page_size": PAGE_SIZE}
	for key in SECTIONS:
		summary[key] = build_section(key, source, 0)
	return summary


def read_source(employee):
	meta = frappe.get_meta("Employee")
	levels = meta.get_permlevel_access("read")
	readable = [
		field
		for field in SOURCE_FIELDS
		if not meta.get_field(field) or meta.get_field(field).permlevel in levels
	]
	source = frappe.db.get_value("Employee", employee, readable, as_dict=True)
	return frappe._dict({field: source.get(field) for field in SOURCE_FIELDS})


def build_section(key, source, offset):
	gates, builder, _paged = SECTIONS[key]
	try:
		if not all(can_read(*gate) for gate in gates):
			return {"hidden": True}
		return builder(source, offset)
	except Exception:
		frappe.log_error(
			title=f"Employee Financial Summary: {key}",
			reference_doctype="Employee",
			reference_name=source.name,
		)
		return {"hidden": True}


def can_read(doctype, fields, parenttype=None):
	if not frappe.has_permission(doctype, "read", parent_doctype=parenttype):
		return False
	meta = frappe.get_meta(doctype)
	levels = meta.get_permlevel_access("read", parenttype)
	return all(meta.get_field(field).permlevel in levels for field in fields if meta.get_field(field))


def page(rows, offset):
	return {
		"rows": rows[:PAGE_SIZE],
		"has_more": len(rows) > PAGE_SIZE,
		"offset": offset,
	}


def page_window(offset):
	return {"limit_start": offset, "limit_page_length": PAGE_SIZE + 1}


def employee_section(source, offset):
	rows = frappe.get_list("Employee", filters={"name": source.name}, fields=EMPLOYEE_FIELDS)
	return rows[0] if rows else {"hidden": True}


def structure_section(source, offset):
	assignments = frappe.get_list(
		"Salary Structure Assignment",
		filters={"employee": source.name, "docstatus": 1},
		fields=STRUCTURE_FIELDS,
		order_by="from_date desc",
		limit_page_length=1,
	)
	if not assignments:
		return {"value": None}
	assignment = assignments[0]
	parts = [
		["Basic", flt(assignment.base)],
		["Housing", flt(assignment.custom_housing) or flt(assignment.housing)],
		["Transportation", flt(assignment.transportation_allowance)],
		["Food", flt(assignment.food_allowance)],
		["Supervisor", flt(assignment.supervisor_allowance)],
		["Attendance", flt(assignment.attendance_allowance)],
	]
	return {
		"value": {
			"name": assignment.name,
			"salary_structure": assignment.salary_structure,
			"from_date": assignment.from_date,
			"parts": [part for part in parts if part[1]],
			"wage": sum(part[1] for part in parts),
		}
	}


def last_slip_section(source, offset):
	slips = frappe.get_list(
		"Salary Slip",
		filters={"employee": source.name, "docstatus": 1},
		fields=["name", "start_date", "net_pay"],
		order_by="start_date desc",
		limit_page_length=1,
	)
	breakdown = []
	if slips:
		breakdown = frappe.get_list(
			"Salary Detail",
			filters={"parent": slips[0].name, "parenttype": "Salary Slip"},
			fields=SLIP_DETAIL_FIELDS,
			order_by="parentfield asc, idx asc",
			parent_doctype="Salary Slip",
			limit_page_length=0,
		)
	year = getdate().year
	ytd = frappe.get_list(
		"Salary Slip",
		filters={
			"employee": source.name,
			"docstatus": 1,
			"start_date": ["between", [f"{year}-01-01", f"{year}-12-31"]],
		},
		fields=[
			{"SUM": "gross_pay", "as": "gross"},
			{"SUM": "total_deduction", "as": "deduction"},
			{"SUM": "net_pay", "as": "net"},
			{"COUNT": "*", "as": "slips"},
		],
	)[0]
	return {
		"slip": slips[0] if slips else None,
		"breakdown": breakdown,
		"ytd": {
			"gross": flt(ytd.gross),
			"deduction": flt(ytd.deduction),
			"net": flt(ytd.net),
			"slips": cint(ytd.slips),
		},
	}


def slips_section(source, offset):
	rows = frappe.get_list(
		"Salary Slip",
		filters={"employee": source.name, "docstatus": 1},
		fields=SLIP_FIELDS,
		order_by="start_date desc",
		**page_window(offset),
	)
	return page(rows, offset)


def loan_balance(loan):
	return flt(loan.disbursed_amount or loan.loan_amount) - flt(loan.total_principal_paid)


def loans_section(source, offset):
	filters = {"applicant_type": "Employee", "applicant": source.name, "docstatus": 1}
	rows = frappe.get_list(
		"Loan",
		filters=filters,
		fields=LOAN_FIELDS,
		order_by="posting_date desc",
		**page_window(offset),
	)
	for loan in rows:
		loan.balance = loan_balance(loan)
	out = page(rows, offset)
	if not offset:
		every = frappe.get_list("Loan", filters=filters, fields=LOAN_FIELDS, limit_page_length=0)
		out["count"] = len(every)
		out["balance"] = sum(loan_balance(loan) for loan in every)
	return out


def advances_section(source, offset):
	filters = {"employee": source.name, "docstatus": 1}
	rows = frappe.get_list(
		"Employee Advance",
		filters=filters,
		fields=ADVANCE_FIELDS,
		order_by="posting_date desc",
		**page_window(offset),
	)
	for advance in rows:
		advance.balance = flt(advance.paid_amount) - flt(advance.claimed_amount) - flt(advance.return_amount)
	out = page(rows, offset)
	if not offset:
		totals = frappe.get_list(
			"Employee Advance",
			filters=filters,
			fields=[
				{"COUNT": "*", "as": "count"},
				{"SUM": "paid_amount", "as": "paid"},
				{"SUM": "claimed_amount", "as": "claimed"},
				{"SUM": "return_amount", "as": "returned"},
			],
		)[0]
		out["count"] = cint(totals.count)
		out["balance"] = flt(totals.paid) - flt(totals.claimed) - flt(totals.returned)
	return out


def eos_section(source, offset):
	wage = flt(source.basic_wage)
	if not source.date_of_joining or not wage:
		return {"estimate": None}
	as_of = getdate(source.relieving_date) if source.relieving_date else getdate()
	per_day = daily_wage(wage)
	span, eos_days, amount = settlement_award(EOS_REASON, source.date_of_joining, as_of, per_day)
	return {
		"estimate": {
			"years": round(service_years(*span), 2),
			"service_days": date_diff(as_of, source.date_of_joining),
			"eos_days": round(eos_days, 2),
			"wage": wage,
			"per_day": per_day,
			"amount": amount,
			"as_of": as_of,
			"reason": EOS_REASON,
		}
	}


def eos_records_section(source, offset):
	rows = frappe.get_list(
		"End of Service Settlement",
		filters={"employee": source.name, "docstatus": ["<", 2]},
		fields=EOS_RECORD_FIELDS,
		order_by="creation desc",
		**page_window(offset),
	)
	return page(rows, offset)


def vacation_records_section(source, offset):
	rows = frappe.get_list(
		"Advance Leave Salary",
		filters={"employee": source.name, "docstatus": ["<", 2]},
		fields=VACATION_FIELDS,
		order_by="creation desc",
		**page_window(offset),
	)
	return page(rows, offset)


def leave_balance_section(source, offset):
	grouped = frappe.get_list(
		"Leave Ledger Entry",
		filters={
			"employee": source.name,
			"docstatus": 1,
			"is_expired": 0,
			"to_date": [">=", getdate()],
		},
		fields=["leave_type", {"SUM": "leaves", "as": "balance"}],
		group_by="leave_type",
		order_by="leave_type asc",
		limit_page_length=0,
	)
	rows = [row for row in grouped if flt(row.balance)]
	return page(rows[offset : offset + PAGE_SIZE + 1], offset)


def ledger_section(source, offset):
	grouped = frappe.get_list(
		"GL Entry",
		filters={"party_type": "Employee", "party": source.name, "is_cancelled": 0},
		fields=[
			"account",
			{"SUM": "debit", "as": "debit"},
			{"SUM": "credit", "as": "credit"},
		],
		group_by="account",
		order_by="account asc",
		limit_page_length=0,
	)
	rows = []
	for row in grouped:
		balance = flt(row.debit) - flt(row.credit)
		if abs(balance) > 0.005:
			rows.append({"account": row.account, "balance": balance})
	return page(rows[offset : offset + PAGE_SIZE + 1], offset)


def requisitions_section(source, offset):
	account_no = (source.iban or source.bank_ac_no or "").replace(" ", "").upper()
	if len(account_no) < 10:
		return {
			"rows": [],
			"has_more": False,
			"offset": offset,
			"account_no": "",
			"paid": 0,
		}
	requisition = frappe.qb.DocType("Payment Requisition")
	names = (
		frappe.qb.from_(requisition)
		.select(requisition.name)
		.where(Upper(Replace(requisition.account_no, " ", "")) == account_no)
		.run(pluck=True)
	)
	rows = []
	if names:
		rows = frappe.get_list(
			"Payment Requisition",
			filters={"name": ["in", names], "docstatus": ["<", 2]},
			fields=["name", "date", "amount", "workflow_state"],
			order_by="date desc",
			**page_window(offset),
		)
	out = page(rows, offset)
	out["account_no"] = account_no
	if not offset:
		out["paid"] = 0
		if names:
			out["paid"] = flt(
				frappe.get_list(
					"Payment Requisition",
					filters={"name": ["in", names], "workflow_state": "Paid"},
					fields=[{"SUM": "amount", "as": "paid"}],
				)[0].paid
			)
	return out


SECTIONS = {
	"employee": ([("Employee", EMPLOYEE_FIELDS)], employee_section, False),
	"structure": (
		[("Salary Structure Assignment", STRUCTURE_FIELDS)],
		structure_section,
		False,
	),
	"last_slip": (
		[
			("Salary Slip", SLIP_FIELDS),
			("Salary Detail", SLIP_DETAIL_FIELDS, "Salary Slip"),
		],
		last_slip_section,
		False,
	),
	"slips": ([("Salary Slip", SLIP_FIELDS)], slips_section, True),
	"loans": ([("Loan", LOAN_FIELDS)], loans_section, True),
	"advances": ([("Employee Advance", ADVANCE_FIELDS)], advances_section, True),
	"eos": ([("End of Service Settlement", EOS_FIELDS)], eos_section, False),
	"eos_records": (
		[("End of Service Settlement", EOS_RECORD_FIELDS)],
		eos_records_section,
		True,
	),
	"vacation_records": (
		[("Advance Leave Salary", VACATION_FIELDS)],
		vacation_records_section,
		True,
	),
	"leave_balance": (
		[("Leave Ledger Entry", LEAVE_FIELDS)],
		leave_balance_section,
		True,
	),
	"ledger": ([("GL Entry", LEDGER_FIELDS)], ledger_section, True),
	"requisitions": (
		[("Payment Requisition", REQUISITION_FIELDS)],
		requisitions_section,
		True,
	),
}

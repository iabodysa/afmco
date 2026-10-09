# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import date_diff, flt, rounded

ADVANCE_LEAVE_SALARY = "Advance Leave Salary"
PERIOD_DOCTYPE = "Contract Vacation Allowance"
SETTLED_STATES = ("Approved", "Paid")
PAID = "Paid"
COMMERCIAL_ROUNDING = "Commercial Rounding"


def settled_periods(employee, exclude):
	names = frappe.get_all(
		ADVANCE_LEAVE_SALARY,
		filters={"employee": employee, "name": ["!=", exclude], "workflow_state": ["in", SETTLED_STATES]},
		pluck="name",
	)
	if not names:
		return []
	return frappe.get_all(
		PERIOD_DOCTYPE,
		filters={"parenttype": ADVANCE_LEAVE_SALARY, "parentfield": "cva", "parent": ["in", names]},
		fields=["contract_start_date", "contract_end_date"],
	)


def overlaps(row, period):
	if not (row.contract_start_date and row.contract_end_date and period.contract_start_date and period.contract_end_date):
		return False
	return (
		date_diff(period.contract_end_date, row.contract_start_date) > 0
		and date_diff(row.contract_end_date, period.contract_start_date) > 0
	)


def mark_settled_periods_paid(doc):
	if not (doc.employee and doc.cva):
		return False
	periods = settled_periods(doc.employee, doc.name)
	marked = False
	for row in doc.cva:
		if row.status != PAID and any(overlaps(row, period) for period in periods):
			row.status = PAID
			marked = True
	return marked


def apply_settled_periods(doc, precision):
	if not mark_settled_periods_paid(doc):
		return
	previous = flt(doc.cva_total)
	unpaid = sum(flt(row.amount3) for row in doc.cva if row.status != PAID)
	doc.cva_total = rounded(unpaid, precision, COMMERCIAL_ROUNDING)
	doc.amount = rounded(flt(doc.amount) - previous + doc.cva_total, 2, COMMERCIAL_ROUNDING)

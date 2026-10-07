# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import flt

EMPLOYEE_ADVANCES_ACCOUNT_NUMBER = "124001"
SALARY_FIELDS = [
	"base",
	"housing",
	"custom_housing",
	"variable",
	"commission",
	"transportation_allowance",
	"food_allowance",
	"supervisor_allowance",
	"attendance_allowance",
]


@frappe.whitelist()
def get_employee_dues(employee):
	frappe.only_for("General Manager")
	frappe.has_permission("Employee", "read", employee, throw=True)
	company = frappe.db.get_value("Employee", employee, "company")
	return {
		"advance_balance": employee_advance_balance(employee, company),
		"monthly_salary": employee_monthly_salary(employee),
	}


def employee_advance_balance(employee, company):
	account = frappe.db.get_value(
		"Account", {"account_number": EMPLOYEE_ADVANCES_ACCOUNT_NUMBER, "company": company}, "name"
	)
	if not account:
		return 0
	totals = frappe.get_list(
		"GL Entry",
		filters={"account": account, "party_type": "Employee", "party": employee},
		fields=[{"SUM": "debit", "as": "total_debit"}, {"SUM": "credit", "as": "total_credit"}],
	)
	return flt(totals[0].total_debit) - flt(totals[0].total_credit) if totals else 0


def employee_monthly_salary(employee):
	assignment = frappe.get_list(
		"Salary Structure Assignment",
		filters={"employee": employee, "docstatus": 1},
		fields=SALARY_FIELDS,
		order_by="from_date desc",
		limit=1,
	)
	return sum(flt(assignment[0][field]) for field in SALARY_FIELDS) if assignment else 0

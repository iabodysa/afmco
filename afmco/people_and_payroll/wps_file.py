# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import csv
import io
import re
from collections import Counter

import frappe
from frappe import _
from frappe.utils import cstr, flt

PAGE = "wps-file"
REGISTER_FORMAT = "Salary Register WPS"
FILE_FORMATS = (REGISTER_FORMAT, "NCBK", "SIBC")
HEADER = (
	"Bank",
	"IBAN",
	"Total Salary",
	"Remark",
	"Employee Name",
	"ID",
	"Address",
	"Basic salary",
	"Housing",
	"Other allowances",
	"Deductions",
)
FILE_FIELDS = (
	"bank_name",
	"bank_account_no",
	"net_pay",
	"remark",
	"employee_name",
	"employee",
	"branch",
	"basic33",
	"housing33",
	"other_allowance33",
	"deduction33",
)
NUMBER_FIELDS = ("net_pay", "basic33", "housing33", "other_allowance33", "deduction33")
NATIONAL_ID = re.compile(r"^[12][0-9]{9}$")


def check_access():
	if not frappe.get_cached_doc("Page", PAGE).is_permitted():
		raise frappe.PermissionError
	frappe.has_permission("Salary Slip", "report", throw=True)


def get_slips(company, from_date, to_date, payroll_entry=None, bank_name=None):
	filters = {
		"docstatus": 1,
		"company": company,
		"start_date": [">=", from_date],
		"end_date": ["<=", to_date],
	}
	if payroll_entry:
		filters["payroll_entry"] = payroll_entry
	if bank_name:
		filters["bank_name"] = bank_name
	slips = frappe.get_list(
		"Salary Slip",
		filters=filters,
		fields=["name", "payroll_entry", *FILE_FIELDS],
		order_by="name asc",
	)
	for slip in slips:
		for field in NUMBER_FIELDS:
			slip[field] = flt(slip[field])
	return slips


def get_problems(slips):
	per_employee = Counter(slip.employee for slip in slips)
	problems = []

	def add(slip, check, message):
		problems.append(
			{
				"check": check,
				"salary_slip": slip.name,
				"employee": slip.employee,
				"employee_name": slip.employee_name,
				"message": message,
			}
		)

	for slip in slips:
		if not cstr(slip.bank_account_no).strip():
			add(slip, "iban", _("IBAN is missing", context="WPS File"))
		if not cstr(slip.bank_name).strip():
			add(slip, "bank", _("Bank is missing", context="WPS File"))
		if not NATIONAL_ID.match(cstr(slip.employee)):
			add(slip, "id", _("ID is not a 10-digit national or iqama number", context="WPS File"))
		if slip.net_pay <= 0:
			add(slip, "net_pay", _("Net pay is zero or negative", context="WPS File"))
		if per_employee[slip.employee] > 1:
			add(
				slip,
				"duplicate",
				_("Employee has {0} salary slips in this selection", context="WPS File").format(
					per_employee[slip.employee]
				),
			)
	return problems


def js_number(value):
	return str(int(value)) if value.is_integer() else repr(value)


def file_cell(slip, field):
	value = slip[field]
	if field in NUMBER_FIELDS:
		return js_number(value)
	return cstr(value)


def build_csv(slips):
	buffer = io.StringIO()
	buffer.write(",".join(HEADER) + "\n")
	writer = csv.writer(buffer, lineterminator="\n")
	writer.writerows([*(file_cell(slip, field) for field in FILE_FIELDS), ""] for slip in slips)
	return buffer.getvalue()


def file_name(slips):
	return f"Salary_Register_{len(slips)}_Rows.csv"


def build_file(slips, file_format):
	if file_format not in FILE_FORMATS:
		frappe.throw(_("Unknown file format {0}", context="WPS File").format(file_format))
	if file_format == REGISTER_FORMAT:
		return file_name(slips), build_csv(slips)
	builder = frappe.new_doc("WPS Consolidated Report")
	builder.bank_format = file_format
	headers, rows = builder._build_matrix_rows(slips)
	return f"WPS_{file_format}_{len(slips)}_Rows.csv", builder._make_csv(headers, rows).decode("utf-8")


def build_payroll_entry_file(payroll_entry, bank_format, file_type):
	builder = frappe.new_doc("WPS Consolidated Report")
	builder.name = payroll_entry
	builder.bank_format = bank_format
	builder.file_type = file_type
	builder.append("payroll_entries", {"payroll_entry": payroll_entry})
	builder._validate_selects()
	files, bat_blocks = builder._build_files(builder._group_by_labor_office(builder._fetch_slips()))
	if not files:
		frappe.throw(_("No submitted salary slips with net pay in this payroll entry", context="WPS File"))
	content, filename, _single_file = builder._bundle_files(files, builder._build_bat_script(bat_blocks))
	return filename, content.getvalue()

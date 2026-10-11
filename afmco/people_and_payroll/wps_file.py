# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import base64
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


def get_slips(company, from_date, to_date, payroll_entry=None):
	filters = {
		"docstatus": 1,
		"company": company,
		"start_date": [">=", from_date],
		"end_date": ["<=", to_date],
	}
	if payroll_entry:
		filters["payroll_entry"] = payroll_entry
	slips = frappe.get_list(
		"Salary Slip",
		filters=filters,
		fields=[
			"name",
			"payroll_entry",
			"iban_holder_name",
			"labor_office_file_number",
			"hold",
			"end_date",
			*FILE_FIELDS,
		],
		order_by="name asc",
	)
	cost_centers = dict(
		frappe.get_all(
			"Payroll Entry",
			filters={"name": ["in", list({slip.payroll_entry for slip in slips if slip.payroll_entry})]},
			fields=["name", "cost_center"],
			as_list=True,
		)
	)
	for slip in slips:
		slip.cost_center = cost_centers.get(slip.payroll_entry) or ""
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


def get_file_groups(slips):
	grouped = frappe.new_doc("WPS Consolidated Report")._group_by_labor_office(slips)
	hold = grouped.pop("WPS_HOLD_FILE", [])
	offices = [office for office in grouped if office != "NO_LABOR_OFFICE"]
	crs = {}
	if offices:
		for office, cr in frappe.get_all(
			"Corporation",
			filters={"establishment_number": ["in", offices]},
			fields=["establishment_number", "cr"],
			as_list=True,
		):
			crs.setdefault(office, cr)
	files = [
		{
			"labor_office_file_number": "" if office == "NO_LABOR_OFFICE" else office,
			"corporation_cr": crs.get(office) or "",
			"employees_count": len(rows),
			"total_net_pay": flt(sum(row.net_pay for row in rows), 2),
		}
		for office, rows in grouped.items()
	]
	return {
		"files": files,
		"employees_count": sum(file["employees_count"] for file in files),
		"total_net_pay": flt(sum(file["total_net_pay"] for file in files), 2),
		"hold": {"employees_count": len(hold), "total_net_pay": flt(sum(row.net_pay for row in hold), 2)},
	}


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


def build_file(slips, file_format, reference):
	if file_format not in FILE_FORMATS:
		frappe.throw(_("Unknown file format {0}", context="WPS File").format(file_format))
	if file_format == REGISTER_FORMAT:
		filename, content = file_name(slips), build_csv(slips).encode("utf-8")
	else:
		builder = frappe.new_doc("WPS Consolidated Report")
		builder.name = reference
		builder.bank_format = file_format
		builder.file_type = "CSV"
		filename, content = bundle_bank_files(builder, slips)
	return filename, base64.b64encode(content).decode("ascii")


def bundle_bank_files(builder, slips):
	files, bat_blocks = builder._build_files(builder._group_by_labor_office(slips))
	if not files:
		frappe.throw(_("No submitted salary slips with net pay in this payroll entry", context="WPS File"))
	content, filename, _single_file = builder._bundle_files(files, builder._build_bat_script(bat_blocks))
	return filename, content.getvalue()


def build_payroll_entry_file(payroll_entry, bank_format, file_type):
	builder = frappe.new_doc("WPS Consolidated Report")
	builder.name = payroll_entry
	builder.bank_format = bank_format
	builder.file_type = file_type
	builder.append("payroll_entries", {"payroll_entry": payroll_entry})
	builder._validate_selects()
	return bundle_bank_files(builder, builder._fetch_slips())

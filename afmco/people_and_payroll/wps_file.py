# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import base64
import csv
import io
import math
import re
import zipfile
from collections import Counter
from datetime import datetime

import frappe
from frappe import _
from frappe.utils import cstr, flt

from afmco.people_and_payroll.doctype.temporary_iban.temporary_iban import apply_active_temporary_ibans

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
BANK_FORMATS = ("NCBK", "SIBC")
FILE_EXTENSIONS = {"CSV": "csv", "Excel": "xlsx"}
EMP_HEADERS_NCBK = [
	"Bank",
	"Account Number",
	"Total Salary",
	"Transaction Reference",
	"Employee Name",
	"National ID/Iqama ID",
	"Employee Address",
	"Basic Salary",
	"Housing Allowance",
	"Other Earnings",
	"Deductions",
]
EMP_HEADERS_SIBC = [
	"Employee",
	"First Name",
	"Middle Name",
	"Last Name",
	"Bank Name",
	"Bank Account No.",
	"Basic",
	"Housing",
	"Other Allowance",
	"Deduction",
	"Net Pay",
	"Remark",
]
HOLD_GROUP = "WPS_HOLD_FILE"
NO_OFFICE_GROUP = "NO_LABOR_OFFICE"
SLIP_BATCH = 1_000


def check_access():
	if not frappe.get_cached_doc("Page", PAGE).is_permitted():
		raise frappe.PermissionError
	frappe.has_permission("Salary Slip", "report", throw=True)


def get_slips(company, payroll_entry):
	if not payroll_entry:
		frappe.throw(_("Select a Payroll Entry", context="WPS File"))
	filters = {"docstatus": 1, "company": company, "payroll_entry": payroll_entry}
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
	apply_active_temporary_ibans(slips)
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
	grouped = group_by_labor_office(slips)
	hold = grouped.pop(HOLD_GROUP, [])
	offices = [office for office in grouped if office != NO_OFFICE_GROUP]
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
			"labor_office_file_number": "" if office == NO_OFFICE_GROUP else office,
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


def build_file(slips, file_format):
	if file_format not in FILE_FORMATS:
		frappe.throw(_("Unknown file format {0}", context="WPS File").format(file_format))
	if file_format == REGISTER_FORMAT:
		files = [{"filename": file_name(slips), "content": build_csv(slips)}]
	else:
		files, bat_script = bank_files(slips, file_format, "CSV", [])
		if len(files) > 1:
			files = [*files, {"filename": "generate_wps_files.bat", "content": bat_script}]
	return [
		{
			"filename": file["filename"],
			"content": base64.b64encode(
				file["content"].encode("utf-8") if isinstance(file["content"], str) else file["content"]
			).decode("ascii"),
		}
		for file in files
	]


def bank_files(slips, bank_format, file_type, payroll_entries):
	files, bat_blocks = build_bank_files(group_by_labor_office(slips), bank_format, file_type)
	if not files:
		frappe.throw(_("No submitted salary slips with net pay in this payroll entry", context="WPS File"))
	return files, build_bat_script(bat_blocks, payroll_entries)


def build_payroll_entry_file(payroll_entry, bank_format, file_type):
	if bank_format not in BANK_FORMATS or file_type not in FILE_EXTENSIONS:
		frappe.throw(_("Unknown file format {0}", context="WPS File").format(f"{bank_format} {file_type}"))
	files, bat_script = bank_files(
		fetch_submitted_slips(payroll_entry), bank_format, file_type, [payroll_entry]
	)
	if len(files) == 1 and file_type == "CSV":
		content = files[0]["content"]
		return files[0]["filename"], content.encode("utf-8") if isinstance(content, str) else content
	buffer = io.BytesIO()
	with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
		for file in files:
			archive.writestr(file["filename"], file["content"])
		archive.writestr("generate_wps_files.bat", bat_script.encode("utf-8"))
	return f"WPS_Report_{payroll_entry}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip", buffer.getvalue()


def fetch_submitted_slips(payroll_entry):
	cost_center = frappe.get_doc("Payroll Entry", payroll_entry).get("cost_center", "")
	results = []
	start = 0
	while True:
		batch = frappe.get_all(
			"Salary Slip",
			filters={"payroll_entry": payroll_entry, "docstatus": 1},
			fields=[
				"name",
				"employee",
				"employee_name",
				"iban_holder_name",
				"payroll_entry",
				"labor_office_file_number",
				"bank_name",
				"bank_account_no",
				"basic33",
				"housing33",
				"other_allowance33",
				"deduction33",
				"remark",
				"net_pay",
				"hold",
				"start_date",
				"end_date",
				"company",
			],
			limit_start=start,
			limit_page_length=SLIP_BATCH,
		)
		for slip in batch:
			slip["cost_center"] = cost_center
		results.extend(batch)
		if len(batch) < SLIP_BATCH:
			break
		start += SLIP_BATCH
	apply_active_temporary_ibans(results)
	return results


def group_by_labor_office(slips):
	grouped = {}
	hold_slips = []
	for slip in slips:
		if slip.get("hold") == 1:
			hold_slips.append(slip)
			continue
		if not slip.get("net_pay") or slip["net_pay"] <= 0:
			continue
		grouped.setdefault(slip.get("labor_office_file_number") or NO_OFFICE_GROUP, []).append(slip)
	if hold_slips:
		grouped[HOLD_GROUP] = hold_slips
	return grouped


def build_bank_files(grouped, bank_format, file_type):
	files, bat_blocks = [], []
	for office, slips in grouped.items():
		is_hold_file = office == HOLD_GROUP
		if not is_hold_file:
			slips = [slip for slip in slips if slip.get("net_pay") and slip["net_pay"] > 0]
			if not slips:
				continue
		total_net = sum(slip.get("net_pay", 0) for slip in slips)
		corporation = ""
		corporation_cr = ""
		if not is_hold_file and office != NO_OFFICE_GROUP:
			corps = frappe.get_all(
				"Corporation",
				filters=[["establishment_number", "=", office]],
				fields=["name", "cr"],
				limit=1,
			)
			if corps:
				corporation = corps[0].name
				corporation_cr = corps[0].get("cr", "")
		filename = bank_file_name(office, corporation_cr, slips, total_net, is_hold_file, file_type)
		headers, rows = bank_rows(slips, bank_format)
		content = make_csv(headers, rows) if file_type == "CSV" else make_xlsx(headers, rows)
		files.append(
			{
				"filename": filename,
				"content": content,
				"labor_office_file_number": office if not is_hold_file else "WPS Hold File",
				"employees_count": len(slips),
				"total_net_pay": total_net,
				"corporation": corporation,
				"corporation_cr": corporation_cr,
				"is_hold_file": is_hold_file,
				"rows": rows,
			}
		)
		bat_blocks.append(bat_block(filename, rows, bank_format))
	return files, bat_blocks


def bank_file_name(office, corporation_cr, slips, total_net, is_hold_file, file_type):
	extension = FILE_EXTENSIONS[file_type]
	if is_hold_file:
		return f"WPS_Hold_File_{datetime.now().strftime('%y%m%d')}.{extension}"
	end_date = slips[0].get("end_date") if slips else datetime.now()
	if isinstance(end_date, str):
		end_date = datetime.strptime(end_date, "%Y-%m-%d")
	elif not end_date:
		end_date = datetime.now()
	halalas = str(int(round((total_net % 1) * 100))).zfill(2)
	month_abbr = end_date.strftime("%b").upper()
	year_two_digit = end_date.strftime("%y")
	cost_center = slips[0].get("cost_center", "") if slips else ""
	project_name = " - ".join(
		[part.strip() for part in cost_center.split("-") if not any("\u0600" <= c <= "\u06FF" for c in part)][:2]
	)
	return f"{office} {corporation_cr} {len(slips)} {int(total_net)} {halalas} {project_name} {month_abbr} {year_two_digit}.{extension}"


def bank_rows(slips, bank_format):
	if bank_format == "NCBK":
		return EMP_HEADERS_NCBK, [
			[
				slip.get("bank_name", ""),
				slip.get("bank_account_no", ""),
				slip.get("net_pay", ""),
				slip.get("remark", ""),
				slip.get("iban_holder_name") or slip.get("employee_name", ""),
				slip.get("employee", ""),
				"RUH",
				slip.get("basic33", ""),
				slip.get("housing33", ""),
				slip.get("other_allowance33", ""),
				slip.get("deduction33", ""),
			]
			for slip in slips
		]
	rows = []
	for slip in slips:
		first, mid, last = split_name(slip.get("iban_holder_name") or slip.get("employee_name"))
		rows.append(
			[
				slip.get("employee", ""),
				first,
				mid,
				last,
				slip.get("bank_name", ""),
				slip.get("bank_account_no", ""),
				slip.get("basic33", ""),
				slip.get("housing33", ""),
				slip.get("other_allowance33", ""),
				slip.get("deduction33", ""),
				slip.get("net_pay", ""),
				slip.get("remark", ""),
			]
		)
	return EMP_HEADERS_SIBC, rows


def split_name(full):
	if not full:
		return "-", "-", "-"
	parts = full.strip().split()
	first = parts[0] if parts else "-"
	last = parts[-1] if len(parts) > 1 else "-"
	mid = " ".join(parts[1:-1]) if len(parts) > 2 else (parts[1] if len(parts) > 1 else "-")
	return first, mid or "-", last or "-"


def make_csv(headers, rows):
	buffer = io.StringIO()
	csv.writer(buffer).writerows([headers, *rows])
	return buffer.getvalue().encode("utf-8-sig")


def make_xlsx(headers, rows):
	from frappe.utils.xlsxutils import make_xlsx as frappe_make_xlsx

	return frappe_make_xlsx([headers, *rows], "WPS").getvalue()


def bat_block(filename, rows, bank_format):
	headers = EMP_HEADERS_NCBK if bank_format == "NCBK" else EMP_HEADERS_SIBC
	commands = [
		f'echo Creating file: "%dir_name%\\{filename}"',
		f'echo {",".join(headers)} > "%dir_name%\\{filename}"',
	]
	for row in rows:
		line = ",".join(f'"{value}"' for value in row)
		commands.append(f'echo {line} >> "%dir_name%\\{filename}"')
	return "\n".join(commands)


def build_bat_script(blocks, payroll_entries):
	lines = [
		"@echo off",
		"setlocal enabledelayedexpansion",
		"",
		'set "dir_name=%~dp0\\%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"',
		'if not exist "%dir_name%" mkdir "%dir_name%"',
		"",
		*blocks,
		"",
		":: Copy generated files to each Payroll Entry folder",
	]
	for payroll_entry in payroll_entries:
		lines.append(f'if not exist "%~dp0\\{payroll_entry}" mkdir "%~dp0\\{payroll_entry}"')
		lines.append(f'xcopy "%dir_name%\\*" "%~dp0\\{payroll_entry}\\" /Y >nul')
	lines.extend(["", "echo Done!", "pause"])
	return "\r\n".join(lines)

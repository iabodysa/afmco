# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.xlsxutils import build_xlsx_response

PAGE = "employee-id-checker"
EMPLOYEE_FIELDS = [
	"name",
	"employee_name",
	"first_name",
	"nationality",
	"status",
	"department",
	"payroll_cost_center",
	"branch",
	"labor_office_file_number",
	"iqama_expiration_date",
]
SALARY_FIELDS = ["posting_date", "net_pay", "currency"]


@frappe.whitelist(methods=["POST"])
def analyze(employee_ids):
	if not frappe.get_cached_doc("Page", PAGE).is_permitted():
		raise frappe.PermissionError
	employees = frappe.get_list(
		"Employee",
		filters={"name": ("in", frappe.parse_json(employee_ids))},
		fields=EMPLOYEE_FIELDS,
	)
	for employee in employees:
		slips = frappe.get_list(
			"Salary Slip",
			filters={"employee": employee.name, "docstatus": 1},
			fields=SALARY_FIELDS,
			order_by="posting_date desc",
			limit=1,
		)
		employee["last_salary"] = slips[0] if slips else None
	return employees


@frappe.whitelist(methods=["POST"])
def export_xlsx(rows):
	if not frappe.get_cached_doc("Page", PAGE).is_permitted():
		raise frappe.PermissionError
	build_xlsx_response(frappe.parse_json(rows), f"employee_analysis_{frappe.utils.nowdate()}")

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.desk.query_report import get_script as frappe_get_script
from frappe.utils import get_html_format


@frappe.whitelist()
def get_script(report_name: str):
	script = frappe_get_script(report_name)
	if report_name == "Salary Register":
		script["html_format"] = get_html_format(
			frappe.get_app_path("afmco", "people_and_payroll", "salary_register.html")
		)
	return script

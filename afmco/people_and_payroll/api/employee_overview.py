# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from hrms.overrides import employee_overview as hrms_overview

from afmco.people_and_payroll.employee_overview import overview, restricted


@frappe.whitelist()
def get_employee_overview(employee: str, period: str = "Current Fiscal Year"):
	if restricted():
		return overview(employee, period)
	return hrms_overview.get_employee_overview(employee, period)


# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.people_and_payroll.wps_file import (
	REGISTER_FORMAT,
	build_file,
	check_access,
	get_file_groups,
	get_problems,
	get_slips,
)


@frappe.whitelist(methods=["GET"])
def preview(company, from_date, to_date, payroll_entry=None):
	check_access()
	slips = get_slips(company, from_date, to_date, payroll_entry)
	return {"rows": slips, "problems": get_problems(slips), "groups": get_file_groups(slips)}


@frappe.whitelist(methods=["GET"])
def download(company, from_date, to_date, payroll_entry=None, file_format=REGISTER_FORMAT):
	check_access()
	slips = get_slips(company, from_date, to_date, payroll_entry)
	if not slips:
		frappe.throw(_("No submitted salary slips match these filters", context="WPS File"))
	if problems := get_problems(slips):
		frappe.throw(
			_("Resolve the {0} open checks before issuing the file", context="WPS File").format(len(problems))
		)
	return {"files": build_file(slips, file_format)}

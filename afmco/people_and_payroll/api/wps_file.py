# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.people_and_payroll.wps_file import (
	REGISTER_FORMAT,
	build_file,
	check_access,
	get_problems,
	get_slips,
)


@frappe.whitelist(methods=["GET"])
def preview(company, from_date, to_date, payroll_entry=None, bank_name=None):
	check_access()
	slips = get_slips(company, from_date, to_date, payroll_entry, bank_name)
	return {"rows": slips, "problems": get_problems(slips)}


@frappe.whitelist(methods=["GET"])
def download(company, from_date, to_date, payroll_entry=None, bank_name=None, file_format=REGISTER_FORMAT):
	check_access()
	slips = get_slips(company, from_date, to_date, payroll_entry, bank_name)
	if not slips:
		frappe.throw(_("No submitted salary slips match these filters", context="WPS File"))
	if problems := get_problems(slips):
		frappe.throw(
			_("Resolve the {0} open checks before issuing the file", context="WPS File").format(len(problems))
		)
	filename, content = build_file(slips, file_format)
	return {"filename": filename, "content": content}

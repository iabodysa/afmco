# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.rate_limiter import rate_limit

from afmco.people_and_payroll.careers import MAX_RESUME_BYTES, create_application

APPLICATION_FIELDS = (
	"job_title",
	"applicant_name",
	"email_id",
	"phone_number",
	"country",
	"cover_letter",
	"resume_link",
	"currency",
	"lower_range",
	"upper_range",
)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=60 * 60)
def apply():
	values = {fieldname: frappe.form_dict.get(fieldname) for fieldname in APPLICATION_FIELDS}
	resume = frappe.request.files.get("resume") if frappe.request else None
	if resume and resume.filename:
		create_application(values, resume.filename, resume.stream.read(MAX_RESUME_BYTES + 1))
	else:
		create_application(values)
	return {"submitted": True}

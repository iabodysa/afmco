# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.utils import cint, flt, fmt_money, strip_html, validate_email_address, validate_url
from frappe.utils.html_utils import sanitize_html

MAX_RESUME_BYTES = 5 * 1024 * 1024
RESUME_SIGNATURES = {
	".pdf": b"%PDF-",
	".doc": b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1",
	".docx": b"PK\x03\x04",
}
TEXT_LIMITS = {
	"applicant_name": 140,
	"email_id": 140,
	"phone_number": 40,
	"resume_link": 500,
	"cover_letter": 5000,
}
OPEN_JOB_FILTERS = {"status": "Open", "publish": 1}


def get_open_jobs():
	jobs = frappe.get_all(
		"Job Opening",
		filters=OPEN_JOB_FILTERS,
		fields=[
			"name",
			"job_title",
			"description",
			"location",
			"department",
			"employment_type",
			"closes_on",
			"publish_salary_range",
			"lower_range",
			"upper_range",
			"currency",
		],
		order_by="posted_on desc",
	)
	for job in jobs:
		job.description = sanitize_html(job.description or "")
		job.salary_range = (
			" – ".join(fmt_money(amount, currency=job.currency) for amount in (job.lower_range, job.upper_range))
			if job.publish_salary_range and (job.lower_range or job.upper_range)
			else ""
		)
	return jobs


def get_application_options():
	return {
		"countries": frappe.get_all("Country", pluck="name", order_by="name asc"),
		"currencies": frappe.get_all("Currency", filters={"enabled": 1}, pluck="name", order_by="name asc"),
	}


def clean_text(values, fieldname, required=False):
	value = strip_html(str(values.get(fieldname) or "")).strip()
	if required and not value:
		frappe.throw(_("Please fill in all required fields."), frappe.ValidationError)
	if len(value) > TEXT_LIMITS[fieldname]:
		frappe.throw(_("One of the fields is too long."), frappe.ValidationError)
	return value


def validate_application(values):
	application = {
		"applicant_name": clean_text(values, "applicant_name", required=True),
		"email_id": clean_text(values, "email_id", required=True),
		"phone_number": clean_text(values, "phone_number", required=True),
		"cover_letter": clean_text(values, "cover_letter"),
		"resume_link": clean_text(values, "resume_link"),
	}
	if not validate_email_address(application["email_id"]):
		frappe.throw(_("Please enter a valid email address."), frappe.ValidationError)
	if application["resume_link"] and not validate_url(
		application["resume_link"], valid_schemes=("http", "https")
	):
		frappe.throw(_("Please enter a valid CV link starting with https://"), frappe.ValidationError)

	job_title = values.get("job_title") or None
	if job_title and not frappe.db.exists("Job Opening", {"name": job_title, **OPEN_JOB_FILTERS}):
		frappe.throw(_("This job is no longer open for applications."), frappe.ValidationError)
	application["job_title"] = job_title

	for fieldname, doctype in (("country", "Country"), ("currency", "Currency")):
		value = values.get(fieldname) or None
		if value and not frappe.db.exists(doctype, value):
			frappe.throw(_("Please choose a value from the list."), frappe.ValidationError)
		application[fieldname] = value

	lower_range, upper_range = flt(values.get("lower_range")), flt(values.get("upper_range"))
	if lower_range < 0 or upper_range < 0 or (upper_range and lower_range > upper_range):
		frappe.throw(_("Please enter a valid expected salary range."), frappe.ValidationError)
	application["lower_range"], application["upper_range"] = lower_range, upper_range
	return application


def validate_resume(filename, content):
	extension = os.path.splitext(filename or "")[1].lower()
	signature = RESUME_SIGNATURES.get(extension)
	if not signature or not content.startswith(signature):
		frappe.throw(_("Please upload your CV as a PDF or Word file."), frappe.ValidationError)
	if len(content) > MAX_RESUME_BYTES:
		frappe.throw(
			_("Your CV file is larger than {0} MB.").format(cint(MAX_RESUME_BYTES / 1024 / 1024)),
			frappe.ValidationError,
		)
	return extension


def create_application(values, resume_filename=None, resume_content=None):
	application = validate_application(values)
	if resume_content is not None:
		extension = validate_resume(resume_filename, resume_content)
		resume = frappe.get_doc(
			{
				"doctype": "File",
				"file_name": f"cv-{frappe.generate_hash(length=10)}{extension}",
				"content": resume_content,
				"is_private": 1,
			}
		).insert(ignore_permissions=True)
		application["resume_attachment"] = resume.file_url

	return frappe.get_doc({"doctype": "Job Applicant", "status": "Open", **application}).insert(
		ignore_permissions=True
	)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.people_and_payroll.careers import MAX_RESUME_BYTES, get_application_options, get_open_jobs
from afmco.www.portal.index import set_site_context

no_cache = 1

DEFAULT_CURRENCY = "SAR"


def get_context(context):
	set_site_context(context)
	context.title = _("Careers at AFMCO")
	context.description = _("See open jobs at AFMCO and apply online.")
	context.parents = [{"route": context.home_url, "title": _("Home")}]
	context.page_links = [
		{"href": "#jobs", "label": _("Open jobs")},
		{"href": "#apply", "label": _("Apply now")},
	]
	context.header_cta = {"href": "#apply", "label": _("Apply now")}

	context.jobs = get_open_jobs()
	requested_job, requested_route = frappe.form_dict.job_title, frappe.form_dict.job_route
	context.selected_job = next(
		(job.name for job in context.jobs if job.name == requested_job or (requested_route and job.route == requested_route)),
		"",
	)
	options = get_application_options()
	context.countries = options["countries"]
	context.currencies = options["currencies"]
	context.default_currency = DEFAULT_CURRENCY if DEFAULT_CURRENCY in context.currencies else ""
	context.max_resume_mb = MAX_RESUME_BYTES // (1024 * 1024)
	context.max_resume_bytes = MAX_RESUME_BYTES

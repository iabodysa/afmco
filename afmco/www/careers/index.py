# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils.jinja_globals import is_rtl

from afmco.people_and_payroll.careers import MAX_RESUME_BYTES, get_application_options, get_open_jobs
from afmco.www.portal.index import SUPPORT_URL, get_portal_entry, remember_guest_language

no_cache = 1

DEFAULT_CURRENCY = "SAR"


def get_context(context):
	is_guest = frappe.session.user == "Guest"
	is_website_user = not is_guest and frappe.session.data.user_type == "Website User"
	remember_guest_language(is_guest)

	context.page_lang = frappe.local.lang
	context.text_dir = "rtl" if is_rtl() else "ltr"
	context.show_language_switch = is_guest
	context.title = _("Careers at AFMCO")
	context.description = _(
		"Browse the jobs open at AFMCO and send your application and CV in a few minutes."
	)
	context.support_url = SUPPORT_URL
	context.portal_link, context.portal_label = get_portal_entry(is_guest, is_website_user)
	context.portal_css = frappe.read_file(frappe.get_app_path("afmco", "www", "portal", "index.css"))
	context.portal_js = frappe.read_file(frappe.get_app_path("afmco", "www", "portal", "index.js"))

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

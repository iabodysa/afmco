# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.people_and_payroll.iban import BANK_CODES
from afmco.people_and_payroll.iban_request import MAX_CERTIFICATE_BYTES
from afmco.www.portal.index import set_site_context

no_cache = 1


def get_context(context):
	set_site_context(context)
	context.title = _("Update your salary account")
	context.description = _(
		"Send your new IBAN with the certificate from your bank. HR reviews every request before the salary moves to the new account."
	)
	context.parents = [{"route": context.home_url, "title": _("Home")}]
	context.page_links = [
		{"href": "#steps", "label": _("How it works")},
		{"href": "#request", "label": _("Send your request")},
	]
	context.header_cta = {"href": "#request", "label": _("Send your request")}
	context.portal_css = frappe.read_file(frappe.get_app_path("afmco", "www", "portal", "index.css"))
	context.form_css = frappe.read_file(frappe.get_app_path("afmco", "www", "careers", "index.css"))
	context.portal_js = frappe.read_file(frappe.get_app_path("afmco", "www", "portal", "index.js"))
	context.banks = frappe.as_json(BANK_CODES, indent=None)
	context.max_certificate_mb = MAX_CERTIFICATE_BYTES // (1024 * 1024)
	context.max_certificate_bytes = MAX_CERTIFICATE_BYTES

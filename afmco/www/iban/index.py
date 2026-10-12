# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils.jinja_globals import is_rtl

from afmco.people_and_payroll.iban import BANK_CODES
from afmco.www.portal.index import APEX_URL, SUPPORT_URL, get_portal_entry, remember_guest_language

no_cache = 1


def get_context(context):
	is_guest = frappe.session.user == "Guest"
	is_website_user = not is_guest and frappe.session.data.user_type == "Website User"
	remember_guest_language(is_guest)

	context.page_lang = frappe.local.lang
	context.text_dir = "rtl" if is_rtl() else "ltr"
	context.show_language_switch = is_guest
	context.title = _("Update your salary account")
	context.description = _(
		"Send the new IBAN for your salary in a minute. HR reviews every request before the salary moves to the new account."
	)
	context.support_url = SUPPORT_URL
	context.apex_url = APEX_URL
	context.portal_link, context.portal_label = get_portal_entry(is_guest, is_website_user)
	context.portal_css = frappe.read_file(frappe.get_app_path("afmco", "www", "portal", "index.css"))
	context.form_css = frappe.read_file(frappe.get_app_path("afmco", "www", "careers", "index.css"))
	context.portal_js = frappe.read_file(frappe.get_app_path("afmco", "www", "portal", "index.js"))
	context.banks = frappe.as_json(BANK_CODES, indent=None)

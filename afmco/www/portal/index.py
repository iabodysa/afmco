# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils.jinja_globals import is_rtl

from afmco.desk_host import DESK_HOST

no_cache = 1

SUPPORT_URL = "https://care.afmco.sa/"
APEX_URL = "https://apex.afmco.sa"
APP_URL = f"https://{DESK_HOST}"
PAGE_LANGUAGES = ("en", "ar")
NEWS_SLIDESHOW = "Portal News"
NEWS_LIMIT = 10
LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365


def get_context(context):
	is_guest = frappe.session.user == "Guest"
	is_website_user = not is_guest and frappe.session.data.user_type == "Website User"
	remember_guest_language(is_guest)

	context.page_lang = frappe.local.lang
	context.text_dir = "rtl" if is_rtl() else "ltr"
	context.show_language_switch = is_guest
	context.title = _("AFMCO Employee Portal")
	context.description = _(
		"Sign in to manage your leave, track your requests and view your salary slips. Our support team is here whenever you need help."
	)
	context.support_url = SUPPORT_URL
	context.portal_link, context.portal_label = get_portal_entry(is_guest, is_website_user)
	context.apex_url = APEX_URL
	context.services = get_services()
	context.activities = get_activities()
	context.company_values = get_company_values()
	context.hr_contacts = get_hr_contacts()
	context.news = get_news(is_guest, is_website_user)


def remember_guest_language(is_guest):
	if is_guest and frappe.form_dict._lang in PAGE_LANGUAGES:
		frappe.local.cookie_manager.set_cookie(
			"preferred_language", frappe.form_dict._lang, max_age=LANGUAGE_COOKIE_MAX_AGE
		)


def get_portal_entry(is_guest, is_website_user):
	if is_guest:
		return f"{APP_URL}/login", _("Sign in")
	if is_website_user:
		return f"{APP_URL}/me", _("Continue to your account")
	return f"{APP_URL}/desk", _("Continue to your workspace")


def get_news(is_guest, is_website_user):
	if is_guest:
		return []
	if is_website_user and not frappe.db.exists(
		"Employee", {"user_id": frappe.session.user, "status": "Active"}
	):
		return []
	return frappe.get_all(
		"Website Slideshow Item",
		filters={"parenttype": "Website Slideshow", "parent": NEWS_SLIDESHOW},
		fields=["image", "heading", "description", "url"],
		order_by="idx asc",
		limit=NEWS_LIMIT,
	)


def get_services():
	return [
		{
			"title": _("Leave, attendance and salary slips"),
			"text": _(
				"Apply for leave, submit attendance requests, track their progress and view your salary slips."
			),
			"note": _("For employees with an employee app account."),
			"href": f"{APP_URL}/hrms",
			"link_label": _("Open the employee app"),
		},
		{
			"title": _("Your daily work"),
			"text": _("Handle the requests and tasks assigned to you in your department."),
			"note": _("For employees with a work account."),
			"href": f"{APP_URL}/desk",
			"link_label": _("Open the system"),
		},
		{
			"title": _("Update your IBAN"),
			"text": _("Send your new IBAN so your salary is deposited into the right account."),
			"note": _("No sign-in required."),
			"href": "/iban",
			"link_label": _("Open the form"),
		},
		{
			"title": _("Leave request"),
			"text": _("No employee app account? Submit your leave request here."),
			"note": _("No sign-in required."),
			"href": f"{APP_URL}/leave-application/new",
			"link_label": _("Open the form"),
		},
		{
			"title": _("Apply for a job"),
			"text": _("Explore open positions at AFMCO and apply online."),
			"note": _("For applicants from outside the company."),
			"href": "/careers",
			"link_label": _("View open jobs"),
		},
	]


def get_activities():
	return [
		{
			"title": _("App delivery"),
			"text": _("Integrated fleet for fast delivery services for delivery apps and e-commerce stores."),
			"image": "delivery",
		},
		{
			"title": _("Packaging and shipping"),
			"text": _("Advanced logistics services for professional packaging and secure, fast shipping."),
			"image": "shipping",
		},
		{
			"title": _("Warehouses and factories"),
			"text": _("Highly efficient management and operation of warehouses and factories."),
			"image": "warehousing",
		},
	]


def get_company_values():
	return [
		{
			"title": _("Quality and excellence"),
			"text": _(
				"We are committed to providing high-quality services that exceed our clients' expectations."
			),
		},
		{
			"title": _("Reliability and integrity"),
			"text": _("We build our relationships on trust, transparency, and integrity in work."),
		},
		{
			"title": _("Commitment to deadlines"),
			"text": _("We respect our clients' time and are committed to delivering projects on schedule."),
		},
		{
			"title": _("Innovation and development"),
			"text": _(
				"We always strive to develop our services and use the latest technologies and methods."
			),
		},
	]


def get_hr_contacts():
	return [
		{
			"label": _("Complaints email"),
			"value": "legal@afmcoltd.com",
			"href": "mailto:legal@afmcoltd.com",
		},
		{"label": _("Office phone"), "value": "011 403 0200", "href": "tel:+966114030200"},
	]

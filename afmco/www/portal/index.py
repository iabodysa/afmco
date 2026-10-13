# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import format_date, strip_html, today
from frappe.utils.jinja_globals import is_rtl

from afmco.desk_host import DESK_HOST

no_cache = 1

HOME_URL = "https://afmco.sa"
SUPPORT_URL = "https://care.afmco.sa/"
APEX_URL = "https://apex.afmco.sa"
APP_URL = f"https://{DESK_HOST}"
PAGE_LANGUAGES = ("en", "ar")
NEWS_SLIDESHOW = "Portal News"
NEWS_LIMIT = 10
ANNOUNCEMENTS_ROUTE = "announcements"
HOLIDAY_LIMIT = 6
SHOW_EMPLOYEE_APP_CARD = False
LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365


def get_context(context):
	set_site_context(context)
	context.title = _("AFMCO Employee Portal")
	context.description = _(
		"Sign in to manage your leave, track your requests and view your salary slips. Our support team is here whenever you need help."
	)
	context.page_links = [
		{"href": "#services", "label": _("Services")},
		{"href": "#help", "label": _("Help")},
	]
	context.services = get_services()
	context.news = get_news()
	context.announcement = get_announcement()
	context.holidays = get_holidays()
	context.hr_contacts = get_hr_contacts()


def set_site_context(context):
	is_guest = frappe.session.user == "Guest"
	is_website_user = not is_guest and frappe.session.data.user_type == "Website User"
	remember_guest_language(is_guest)

	context.page_lang = frappe.local.lang
	context.text_dir = "rtl" if is_rtl() else "ltr"
	context.show_language_switch = is_guest
	context.home_url = HOME_URL
	context.support_url = SUPPORT_URL
	context.portal_link, context.portal_label = get_portal_entry(is_guest, is_website_user)
	context.header_cta = {"href": context.portal_link, "label": context.portal_label}
	context.site_links = [
		{"href": "/careers", "label": _("Open jobs")},
		{"href": "/iban", "label": _("Update your IBAN")},
		{"href": APEX_URL, "label": _("Apex operations system")},
	]
	context.page_links = []


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


def get_news():
	return frappe.get_all(
		"Website Slideshow Item",
		filters={"parenttype": "Website Slideshow", "parent": NEWS_SLIDESHOW},
		fields=["image", "heading", "description", "url"],
		order_by="idx asc",
		limit=NEWS_LIMIT,
	)


def get_announcement():
	return frappe.db.get_value(
		"Web Page",
		{"route": ANNOUNCEMENTS_ROUTE, "published": 1, "content_type": "Rich Text"},
		["title", "main_section"],
		as_dict=True,
	)


def get_holidays():
	company = frappe.defaults.get_global_default("company")
	holiday_list = company and frappe.db.get_value("Company", company, "default_holiday_list")
	if not holiday_list:
		return []
	holidays = frappe.get_all(
		"Holiday",
		filters={
			"parenttype": "Holiday List",
			"parent": holiday_list,
			"weekly_off": 0,
			"holiday_date": [">=", today()],
		},
		fields=["holiday_date", "description"],
		order_by="holiday_date asc",
		limit=HOLIDAY_LIMIT,
	)
	for holiday in holidays:
		holiday.date_label = format_date(holiday.holiday_date, "d MMMM yyyy")
		holiday.description = strip_html(holiday.description or "")
	return holidays


def get_services():
	services = [
		{
			"title": _("Leave, attendance and salary slips"),
			"text": _(
				"Apply for leave, submit attendance requests, track their progress and view your salary slips."
			),
			"note": _("For employees with an employee app account."),
			"href": f"{APP_URL}/hrms",
			"link_label": _("Open the employee app"),
			"show": SHOW_EMPLOYEE_APP_CARD,
		},
		{
			"title": _("Your daily work"),
			"text": _("See the requests and tasks waiting for you."),
			"note": _("Sign in with your work account."),
			"href": f"{APP_URL}/desk",
			"link_label": _("Open the system"),
			"show": True,
		},
		{
			"title": _("Update your IBAN"),
			"text": _("Changed your bank? Send your new IBAN so your salary reaches you."),
			"note": _("No sign-in required."),
			"href": "/iban",
			"link_label": _("Open the form"),
			"show": True,
		},
		{
			"title": _("Leave request"),
			"text": _("Request your leave online in a few steps."),
			"note": _("For employees without the employee app."),
			"href": f"{APP_URL}/leave-application/new",
			"link_label": _("Open the form"),
			"show": True,
		},
		{
			"title": _("Apply for a job"),
			"text": _("See the open jobs and apply online."),
			"note": _("Share it with anyone looking for work."),
			"href": "/careers",
			"link_label": _("View open jobs"),
			"show": True,
		},
	]
	return [service for service in services if service["show"]]


def get_hr_contacts():
	return [
		{
			"label": _("Complaints email"),
			"value": "legal@afmcoltd.com",
			"href": "mailto:legal@afmcoltd.com",
		},
		{"label": _("Office phone"), "value": "011 403 0200", "href": "tel:+966114030200"},
		{"label": _("Unified Number"), "value": "9200 18678", "href": "tel:920018678"},
	]

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import html
import os
import re

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
PORTAL_IMAGES = "/assets/afmco/images/portal/"
HERO_IMAGE = f"{PORTAL_IMAGES}warehouse-1600.webp"
HEADER_LOGO = {"src": "/assets/afmco/images/portal/afmco-logo-full-white.svg", "width": 983, "height": 424}
LANGUAGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365
LINE_BREAK_TAGS = re.compile(r"<br\s*/?>|</(?:p|div|li|h[1-6])>", re.IGNORECASE)


def get_context(context):
	set_site_context(context)
	context.title = _("AFMCO Employee Portal")
	context.title_prefix = None
	context.description = _("Open jobs, salary account updates and leave requests for AFMCO employees.")
	context.page_links = [
		{"href": "#services", "label": _("Services")},
		{"href": "#help", "label": _("Help")},
	]
	context.services = get_services()
	context.news = get_news()
	context.announcement = get_announcement()
	context.holidays = get_holidays()
	context.hr_contacts = get_hr_contacts()
	context.header_logo = HEADER_LOGO
	context.hero_image = HERO_IMAGE
	context.hero_desktop_image = get_portal_image(HERO_IMAGE, "desktop")


def set_site_context(context):
	is_guest = frappe.session.user == "Guest"
	is_website_user = not is_guest and frappe.session.data.user_type == "Website User"
	remember_guest_language(is_guest)

	context.page_lang = frappe.local.lang
	context.text_dir = "rtl" if is_rtl() else "ltr"
	context.asset_version = frappe.utils.get_build_version()
	context.favicon = "/assets/afmco/images/afmco-app-icon.svg"
	context.image = "/assets/afmco/images/afmco-logo.png"
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
	news = frappe.get_all(
		"Website Slideshow Item",
		filters={"parenttype": "Website Slideshow", "parent": NEWS_SLIDESHOW},
		fields=["image", "custom_phone_image", "heading", "description", "url"],
		order_by="idx asc",
		limit=NEWS_LIMIT,
	)
	for item in news:
		image = item.image or HERO_IMAGE
		item.desktop_image = get_portal_image(image, "desktop")
		item.thumb_image = get_portal_image(image, "thumb") or image
	return news


def get_portal_image(image, size):
	name = f"{os.path.splitext(os.path.basename(image))[0]}-{size}.webp"
	path = frappe.get_app_path("afmco", "public", "images", "portal", name)
	if os.path.isfile(path):
		return f"{PORTAL_IMAGES}{name}?v={int(os.path.getmtime(path))}"


def get_announcement():
	announcement = frappe.db.get_value(
		"Web Page",
		{"route": ANNOUNCEMENTS_ROUTE, "published": 1, "content_type": "Rich Text"},
		["title", "main_section"],
		as_dict=True,
	)
	if announcement:
		announcement.lines = get_text_lines(announcement.main_section)
	return announcement


def get_text_lines(rich_text):
	text = html.unescape(strip_html(LINE_BREAK_TAGS.sub("\n", rich_text or ""))).replace("\xa0", " ")
	return [line.strip() for line in text.splitlines() if line.strip()]


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
			"href": f"{APP_URL}/hrms",
			"link_label": _("Open the employee app"),
			"icon": "people-and-payroll",
			"show": SHOW_EMPLOYEE_APP_CARD,
		},
		{
			"title": _("Your daily work"),
			"href": f"{APP_URL}/desk",
			"link_label": _("Open the system"),
			"icon": "my-tasks",
			"show": True,
		},
		{
			"title": _("Update your IBAN"),
			"href": "/iban",
			"link_label": _("Open the form"),
			"icon": "financial-operations",
			"show": True,
		},
		{
			"title": _("Leave request"),
			"href": f"{APP_URL}/leave-application/new",
			"link_label": _("Open the form"),
			"icon": "people-and-payroll",
			"show": True,
		},
		{
			"title": _("Apply for a job"),
			"href": "/careers",
			"link_label": _("View open jobs"),
			"icon": "afmco",
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

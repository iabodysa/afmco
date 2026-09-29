# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

# Web forms the public may find in search; every other published web form is for staff
PUBLIC_WEB_FORMS = frozenset({"contact", "application-for-employment"})
INTERNAL_ROUTES = frozenset({"app", "desk", "login", "portal", "me", "update-password", "printview", "list", "api"})
CACHE_KEY = "afmco_internal_web_form_routes"
NOINDEX = "noindex, nofollow"


def add_robots_header(response, request):
	first = (request.path or "/").strip("/").split("/", 1)[0]
	if first in INTERNAL_ROUTES or first in internal_web_form_routes():
		response.headers["X-Robots-Tag"] = NOINDEX


def internal_web_form_routes():
	return frappe.cache.get_value(CACHE_KEY, _published_web_form_routes)


def _published_web_form_routes():
	routes = {(route or "").strip("/").split("/", 1)[0] for route in frappe.get_all("Web Form", filters={"published": 1}, pluck="route")}
	return sorted(routes - PUBLIC_WEB_FORMS - {""})


def clear_web_form_routes(doc=None, method=None):
	frappe.cache.delete_value(CACHE_KEY)

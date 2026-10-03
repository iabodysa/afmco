# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from werkzeug.exceptions import abort
from werkzeug.sansio.utils import get_current_url
from werkzeug.urls import iri_to_uri
from werkzeug.utils import redirect

DESK_HOST = "app.afmco.sa"
SITE_HOSTS = frozenset({"afmco.sa", "www.afmco.sa"})
APP_HOST_PATHS = (
	"/app",
	"/desk",
	"/login",
	"/me",
	"/hrms",
	"/update-password",
	"/api/method/login",
	"/api/method/logout",
)


def redirect_desk_to_app_host():
	request = frappe.local.request
	if request.host not in SITE_HOSTS:
		return
	if not any(request.path == path or request.path.startswith(path + "/") for path in APP_HOST_PATHS):
		return
	url = get_current_url("https", DESK_HOST, request.root_path, request.path, request.query_string)
	abort(redirect(iri_to_uri(url), 302 if request.method == "GET" else 307))

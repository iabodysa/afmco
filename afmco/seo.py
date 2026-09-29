# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

# app.afmco.sa is the staff portal, so no page of it belongs in search results
NOINDEX = "noindex, nofollow"


def add_robots_header(response, request):
	response.headers["X-Robots-Tag"] = NOINDEX

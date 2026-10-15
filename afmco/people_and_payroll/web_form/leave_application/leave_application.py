# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.www.portal.index import set_site_context


def get_context(context):
	set_site_context(context)
	context.description = _("Request annual or sick leave online.")
	if not frappe.form_dict.is_list:
		context.template = "afmco/templates/web/web_form.html"
	context.parents = [{"route": context.home_url, "title": _("Home")}]
	context.page_links = [{"href": "#request", "label": _("Send your request")}]
	context.header_cta = {"href": "#request", "label": _("Send your request")}

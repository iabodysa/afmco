# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.desk.reportview import export_query as frappe_export_query


@frappe.whitelist()
def export_query():
	frappe.local.form_dict.pop("with_link_titles", None)
	return frappe_export_query()

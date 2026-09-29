# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe


@frappe.whitelist(methods=["POST"])
def toggle_archive_view():
	show_archive = frappe.defaults.get_user_default("show_archive_preference") != "1"
	frappe.defaults.set_user_default("show_archive_preference", "1" if show_archive else "0")
	return {"show_archive": show_archive}

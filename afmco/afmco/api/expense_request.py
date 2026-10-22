# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext import get_default_company
from frappe.utils import flt, money_in_words


@frappe.whitelist(methods=["POST"])
def toggle_archive_view():
	show_archive = frappe.defaults.get_user_default("show_archive_preference") != "1"
	frappe.defaults.set_user_default("show_archive_preference", "1" if show_archive else "0")
	return {"show_archive": show_archive}


@frappe.whitelist()
def amount_in_words(amount):
	currency = frappe.get_cached_value("Company", get_default_company(), "default_currency")
	return money_in_words(flt(amount), currency)

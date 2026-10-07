# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import os

import frappe
from frappe.boot import get_icon_style


def fill_missing_desktop_icons(bootinfo):
	if not bootinfo.desktop_icons:
		return
	variant = get_icon_style().lower()
	installed = frappe.get_installed_apps()
	for icon in bootinfo.desktop_icons:
		if icon.logo_url or icon.icon_type == "Folder" or icon.app not in installed:
			continue
		slug = icon.label.replace(" ", "_").lower()
		relative = ("icons", "desktop_icons", variant, f"{slug}.svg")
		if not os.path.exists(frappe.get_app_path("afmco", "public", *relative)):
			continue
		if os.path.exists(frappe.get_app_path(icon.app, "public", *relative)):
			continue
		icon.logo_url = "/assets/afmco/" + "/".join(relative)

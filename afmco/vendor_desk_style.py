# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

NUMBER_CARD_COLORS = {
	"Active RQ Worker": "#29CD42",
	"Scheduled Jobs": "#4463F0",
	"Total Website Users": "#449CF0",
	"Website Themes Available": "#761ACB",
}

SIDEBAR_SECTION_ICONS = {
	("Financial Reports", "Registers"): "notebook-tabs",
}


def fill_empty_vendor_desk_style():
	for card, color in NUMBER_CARD_COLORS.items():
		if frappe.db.exists("Number Card", {"name": card, "color": ("is", "not set")}):
			frappe.db.set_value("Number Card", card, "color", color, update_modified=False)

	for (sidebar, label), icon in SIDEBAR_SECTION_ICONS.items():
		for row in frappe.get_all(
			"Workspace Sidebar Item",
			filters={
				"parenttype": "Workspace Sidebar",
				"parent": sidebar,
				"type": "Section Break",
				"label": label,
				"icon": ("is", "not set"),
			},
			pluck="name",
		):
			frappe.db.set_value("Workspace Sidebar Item", row, "icon", icon, update_modified=False)

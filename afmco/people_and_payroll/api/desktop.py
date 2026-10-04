# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from json import loads

import frappe
from frappe import DoesNotExistError

from afmco.desk_views import AfmcoWorkspace


@frappe.whitelist()
@frappe.read_only()
def get_desktop_page(page: str):
	try:
		workspace = AfmcoWorkspace(loads(page))
		workspace.build_workspace()
		return {
			"charts": workspace.charts,
			"shortcuts": workspace.shortcuts,
			"cards": workspace.cards,
			"onboardings": workspace.onboardings,
			"quick_lists": workspace.quick_lists,
			"number_cards": workspace.number_cards,
			"custom_blocks": workspace.custom_blocks,
		}
	except DoesNotExistError:
		frappe.log_error("Workspace Missing")
		return {}

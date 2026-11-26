# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

LOCKED_SINGLE_VALUES = (
	("System Settings", "enable_telemetry", 0),
	("System Settings", "disable_system_update_notification", 1),
	("Push Notification Settings", "enable_push_notification_relay", 0),
)


def lock_vendor_data_paths():
	for doctype, fieldname, value in LOCKED_SINGLE_VALUES:
		if frappe.db.get_single_value(doctype, fieldname) != value:
			frappe.db.set_single_value(doctype, fieldname, value)

import frappe


def execute():
	name = frappe.db.get_value("Custom Field", {"dt": "Journal Entry", "fieldname": "custom_tab_2", "label": "Tab 2"})
	if name:
		frappe.db.set_value("Custom Field", name, "label", "Employee")
		frappe.clear_cache(doctype="Journal Entry")

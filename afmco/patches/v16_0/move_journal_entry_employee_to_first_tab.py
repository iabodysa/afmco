import json

import frappe

DOCTYPE = "Journal Entry"
TAB = "custom_tab_2"
FIELD = "employee"
ANCHOR = "company"


def execute():
	field = frappe.db.get_value("Custom Field", {"dt": DOCTYPE, "fieldname": FIELD}, ["name", "insert_after"], as_dict=True)
	if field and field.insert_after == TAB:
		frappe.db.set_value("Custom Field", field.name, "insert_after", ANCHOR)

	order = frappe.db.get_value("Property Setter", {"doc_type": DOCTYPE, "property": "field_order"}, ["name", "value"], as_dict=True)
	if order:
		fields = [f for f in json.loads(order.value) if f not in (TAB, FIELD)]
		if ANCHOR in fields:
			fields.insert(fields.index(ANCHOR) + 1, FIELD)
		frappe.db.set_value("Property Setter", order.name, "value", json.dumps(fields))

	tab = frappe.db.get_value("Custom Field", {"dt": DOCTYPE, "fieldname": TAB})
	if tab:
		frappe.delete_doc("Custom Field", tab, force=True, ignore_permissions=True)
	frappe.clear_cache(doctype=DOCTYPE)

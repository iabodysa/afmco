import frappe

DOCTYPE = "Employee Transfer Request"


def execute():
	# New transfer requests are raised in Apex; existing ones stay editable for their payment orders
	if not frappe.db.exists("DocType", DOCTYPE):
		return
	for name in frappe.get_all("Custom DocPerm", filters={"parent": DOCTYPE, "create": 1}, pluck="name"):
		frappe.db.set_value("Custom DocPerm", name, "create", 0)
	frappe.clear_cache(doctype=DOCTYPE)

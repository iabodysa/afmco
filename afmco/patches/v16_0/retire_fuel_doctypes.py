import frappe
from frappe.query_builder.functions import Count

from afmco.patches.v16_0.retire_fleet_doctypes import LINKED

PATCH = "afmco.patches.v16_0.retire_fuel_doctypes"
MAX_RECORDS = {
	"Oil Card": 1,
	"Fuel Increase Request": 0,
}
DOCTYPES = tuple(MAX_RECORDS)
CUSTOM_FIELDS = ("Vehicle-custom_car_image",)


def execute():
	for doctype, limit in MAX_RECORDS.items():
		if frappe.db.table_exists(doctype) and count(doctype) > limit:
			raise frappe.ValidationError(f"{PATCH}: {doctype} holds more than {limit} records, retirement stopped")

	removed = []
	for name in frappe.get_all(
		"Client Script", filters={"dt": ("in", DOCTYPES), "enabled": 1}, pluck="name"
	):
		frappe.db.set_value("Client Script", name, "enabled", 0)
		removed.append(f"Client Script {name} disabled")

	for doctype, field in LINKED:
		if doctype == "Client Script":
			continue
		for name in frappe.get_all(doctype, filters={field: ("in", DOCTYPES)}, pluck="name"):
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			removed.append(f"{doctype} {name}")

	for name in CUSTOM_FIELDS:
		if frappe.db.exists("Custom Field", name):
			frappe.delete_doc("Custom Field", name, force=True, ignore_permissions=True)
			removed.append(f"Custom Field {name}")

	for link in frappe.get_all(
		"DocType Link", filters={"link_doctype": ("in", DOCTYPES)}, fields=["name", "parent"]
	):
		frappe.delete_doc("DocType Link", link.name, force=True, ignore_permissions=True)
		frappe.clear_cache(doctype=link.parent)
		removed.append(f"DocType Link {link.parent} {link.name}")

	for doctype in DOCTYPES:
		if frappe.db.exists("DocType", doctype):
			frappe.delete_doc("DocType", doctype, force=True, ignore_permissions=True)
			removed.append(f"DocType {doctype}")

	print(f"{PATCH}: removed {removed}")


def count(doctype):
	return frappe.qb.from_(doctype).select(Count("*")).run()[0][0]

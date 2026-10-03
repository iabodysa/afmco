import frappe

PATCH = "afmco.patches.v16_0.retire_fleet_doctypes"
MAX_RECORDS = {
	"Fleet Location": 187,
	"Vehicle Transfer": 12,
	"Fuel Calculator": 2,
	"Vehicle Inspection Reading": 3,
	"Driver Shift Assignment": 0,
	"Vehicle Change Request": 0,
	"Fuel Supplier Credit Recharge Log": 0,
}
DOCTYPES = (
	"Fleet Location",
	"Vehicle Transfer",
	"Fuel Calculator",
	"Vehicle Fuel Calculator",
	"Fuel Calculate",
	"Vehicle Change Request",
	"Driver Shift Assignment",
	"Vehicle Inspection Reading",
	"Fuel Supplier Credit Recharge Log",
)
FIELDS = (
	("Trip Location Item", "location_name"),
	("Oil Card", "fuel_supplier_credit_recharge_log"),
)
LINKED = (
	("Workflow", "document_type"),
	("Client Script", "dt"),
	("Server Script", "reference_doctype"),
	("Notification", "document_type"),
	("Number Card", "document_type"),
	("Dashboard Chart", "document_type"),
	("Report", "ref_doctype"),
	("Print Format", "doc_type"),
	("Custom Field", "dt"),
	("Property Setter", "doc_type"),
	("Custom DocPerm", "parent"),
)


def execute():
	for doctype, limit in MAX_RECORDS.items():
		if frappe.db.table_exists(doctype) and frappe.db.count(doctype) > limit:
			raise frappe.ValidationError(f"{PATCH}: {doctype} holds more than {limit} records, retirement stopped")

	removed = []
	for parent, fieldname in FIELDS:
		if remove_field(parent, fieldname):
			removed.append(f"DocField {parent}.{fieldname}")
		for name in frappe.get_all(
			"Property Setter", filters={"doc_type": parent, "field_name": fieldname}, pluck="name"
		):
			frappe.delete_doc("Property Setter", name, force=True, ignore_permissions=True)
			removed.append(f"Property Setter {name}")

	for doctype, field in LINKED:
		for name in frappe.get_all(doctype, filters={field: ("in", DOCTYPES)}, pluck="name"):
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			removed.append(f"{doctype} {name}")

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


def remove_field(parent, fieldname):
	if not frappe.db.exists("DocType", parent):
		return False
	doc = frappe.get_doc("DocType", parent)
	kept = [df for df in doc.fields if df.fieldname != fieldname]
	fetching = [df for df in kept if (df.fetch_from or "").split(".", 1)[0] == fieldname]
	if len(kept) == len(doc.fields) and not fetching:
		return False
	for df in fetching:
		df.fetch_from = ""
	doc.fields = kept
	doc.save(ignore_permissions=True)
	return True

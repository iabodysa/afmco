import frappe

PATCH = "afmco.patches.v16_0.replace_renamed_doctype_names_in_filters"
RENAMED = (
	("Expense Request Afmco", "Payment Requisition"),
	("SADAD Group V2", "SADAD Batch"),
	("SADAD Child Table 2", "SADAD Batch Item"),
	("SADAD Child Table 1", "SADAD Setup Account"),
)
# JSON text that names a DocType; rename_doc does not rewrite it
TEXT_FIELDS = (
	("Dashboard Chart", "filters_json"),
	("Dashboard Chart", "dynamic_filters_json"),
	("Number Card", "filters_json"),
	("Number Card", "dynamic_filters_json"),
	("Report", "json"),
	("Kanban Board", "filters"),
)


def execute():
	replaced = []
	for doctype, field in TEXT_FIELDS:
		if not frappe.db.has_column(doctype, field):
			continue
		for old, new in RENAMED:
			rows = frappe.get_all(doctype, filters={field: ["like", f"%{old}%"]}, fields=["name", field], as_list=True)
			for name, value in rows:
				frappe.db.set_value(doctype, name, field, value.replace(old, new), update_modified=False)
				replaced.append(f"{doctype} {name}.{field}")
	print(f"{PATCH}: updated {len(replaced)} {replaced}")

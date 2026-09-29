import frappe

PATCH = "afmco.patches.v16_0.rename_sadad_doctypes"
RENAMED_DOCTYPES = (
	("SADAD Group V2", "SADAD Batch"),
	("SADAD Child Table 2", "SADAD Batch Item"),
	("SADADGroup2", "SADAD Group Item"),
	("SADAD Child Table 1", "SADAD Setup Account"),
)
TEXT_FIELDS = (
	("Client Script", "script"),
	("Server Script", "script"),
	("Report", "query"),
	("Report", "report_script"),
	("Print Format", "html"),
)


def execute():
	pending, done, absent = [], [], []
	for old, new in RENAMED_DOCTYPES:
		has_old = frappe.db.exists("DocType", old)
		has_new = frappe.db.exists("DocType", new)
		if has_old and has_new:
			raise frappe.ValidationError(f"{PATCH}: DocType {old} and DocType {new} both exist")
		if has_old:
			pending.append((old, new))
		elif has_new:
			done.append(new)
		else:
			absent.append(old)

	for old, new in pending:
		frappe.rename_doc("DocType", old, new, force=True)
		if frappe.db.exists("DocType", old) or not frappe.db.exists("DocType", new):
			raise frappe.ValidationError(f"{PATCH}: DocType {old} was not renamed to {new}")

	replaced = []
	for doctype, field in TEXT_FIELDS:
		if not frappe.db.has_column(doctype, field):
			continue
		for old, new in RENAMED_DOCTYPES:
			rows = frappe.get_all(doctype, filters={field: ["like", f"%{old}%"]}, fields=["name", field], as_list=True)
			for name, value in rows:
				frappe.db.set_value(doctype, name, field, value.replace(old, new), update_modified=False)
				replaced.append(f"{doctype} {name}.{field}")

	print(
		f"{PATCH}: renamed {len(pending)} {[old for old, _ in pending]}, {len(done)} already renamed, "
		f"{len(absent)} absent {absent}, text updated in {replaced}"
	)

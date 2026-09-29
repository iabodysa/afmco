import frappe

PATCH = "afmco.patches.v16_0.rename_expense_request_afmco_to_payment_requisition"
OLD = "Expense Request Afmco"
NEW = "Payment Requisition"

# rename_doc updates Link and Dynamic Link values only; code stored in the database names the DocType as text
TEXT_FIELDS = (
	("Client Script", "script"),
	("Server Script", "script"),
	("Report", "query"),
	("Report", "report_script"),
	("Report", "javascript"),
	("Print Format", "html"),
	("Notification", "condition"),
	("Notification", "message"),
)


def execute():
	has_old = frappe.db.exists("DocType", OLD)
	has_new = frappe.db.exists("DocType", NEW)
	if has_old and has_new:
		raise frappe.ValidationError(f"{PATCH}: DocType {OLD} and DocType {NEW} both exist")

	if has_old:
		frappe.rename_doc("DocType", OLD, NEW, force=True)
		if frappe.db.exists("DocType", OLD) or not frappe.db.exists("DocType", NEW):
			raise frappe.ValidationError(f"{PATCH}: DocType {OLD} was not renamed to {NEW}")

	replaced = []
	for doctype, field in TEXT_FIELDS:
		if not frappe.db.has_column(doctype, field):
			continue
		rows = frappe.get_all(doctype, filters={field: ["like", f"%{OLD}%"]}, fields=["name", field], as_list=True)
		for name, value in rows:
			frappe.db.set_value(doctype, name, field, value.replace(OLD, NEW), update_modified=False)
			replaced.append(f"{doctype} {name}.{field}")

	print(f"{PATCH}: renamed {bool(has_old)}, text updated in {len(replaced)} {replaced}")

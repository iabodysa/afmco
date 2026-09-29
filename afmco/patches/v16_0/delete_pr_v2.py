import frappe

PATCH = "afmco.patches.v16_0.delete_pr_v2"
PARENT = "PR v2"
CHILD = "pr v2 table"
ROLE = "PR v2 Expense Approver"
# Record counts on production when the deletion was approved; more means someone is still using it
MAX_RECORDS = {PARENT: 14, CHILD: 8}
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
)


def execute():
	for doctype, limit in MAX_RECORDS.items():
		if frappe.db.table_exists(doctype) and frappe.db.count(doctype) > limit:
			raise frappe.ValidationError(f"{PATCH}: {doctype} holds more than {limit} records, deletion stopped")

	removed = []
	for doctype, field in LINKED:
		for name in frappe.get_all(doctype, filters={field: PARENT}, pluck="name"):
			frappe.delete_doc(doctype, name, force=True, ignore_permissions=True)
			removed.append(f"{doctype} {name}")

	frappe.db.delete("Action Inbox Document Type", {"document_type": PARENT})
	frappe.db.delete("Workflow Action", {"reference_doctype": PARENT})

	for doctype in (PARENT, CHILD):
		if frappe.db.exists("DocType", doctype):
			frappe.delete_doc("DocType", doctype, force=True, ignore_permissions=True)
			removed.append(f"DocType {doctype}")

	if frappe.db.exists("Role", ROLE):
		frappe.db.delete("Has Role", {"role": ROLE})
		frappe.delete_doc("Role", ROLE, force=True, ignore_permissions=True)
		removed.append(f"Role {ROLE}")

	print(f"{PATCH}: removed {removed}")

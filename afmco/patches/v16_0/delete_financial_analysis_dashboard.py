import frappe

DOCTYPE = "Financial Analysis Dashboard"


def execute():
	for name in frappe.get_all("Client Script", filters={"dt": DOCTYPE}, pluck="name"):
		frappe.delete_doc("Client Script", name, force=True, ignore_permissions=True)
	if frappe.db.exists("DocType", DOCTYPE):
		frappe.delete_doc("DocType", DOCTYPE, force=True, ignore_permissions=True)

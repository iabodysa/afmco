import re

import frappe
from frappe.model.utils.rename_field import rename_field
from frappe.modules.utils import sync_customizations

RENAMES = {
	"Payment Requisition": {"custom_role": "role"},
	"Advance Leave Salary": {
		"custom_details": "details",
		"custom_allow_cancel": "allow_cancel",
		"custom_accounting_procedures": "accounting_procedures",
		"custom_hr_procedures": "hr_procedures",
	},
	"Iqama Renewal Tracking": {
		"custom_date_of_joining": "date_of_joining",
		"custom_employee_status": "employee_status",
		"custom_reschedule_date": "reschedule_date",
		"custom_pr_reference": "pr_reference",
		"custom_pr_reference_2": "pr_reference_2",
	},
	"Employee": {
		"custom_ajeer_from": "ajeer_from",
		"custom_column_break_onwcu": "column_break_onwcu",
		"custom_column_break_xh9tk": "column_break_xh9tk",
		"custom_date_of_rejoining": "date_of_rejoining",
		"custom_iqama_expired": "iqama_expired",
		"custom_muqeem__gosi": "muqeem__gosi",
		"custom_muqeem_balance": "muqeem_balance",
		"custom_muqeem_violations_cost": "muqeem_violations_cost",
		"custom_muqeem_violations_count": "muqeem_violations_count",
		"custom_sponsor_name": "sponsor_name",
	},
	"Salary Structure Assignment": {
		"custom_housing": "housing_allowance",
		"custom_update": "salary_update",
	},
	"Payroll Entry": {
		"custom_payroll_clearing_account": "payroll_clearing_account",
		"custom_wps_report_reference": "wps_report_reference",
	},
	"Salary Slip": {
		"custom_column_break_unqdx": "column_break_unqdx",
		"custom_hold": "hold",
		"custom_loan": "loan",
		"custom_loan_account": "loan_account",
		"custom_loans": "loans",
		"custom_loans_amount": "loans_amount",
	},
	"Purchase Invoice": {"custom_year": "year"},
	"Purchase Invoice Item": {"custom_it_asset": "it_asset"},
	"Journal Entry": {"custom_pr_status": "pr_status"},
}


def execute():
	pending = {
		doctype: {old: new for old, new in fields.items() if is_pending(doctype, old)}
		for doctype, fields in RENAMES.items()
	}
	pending = {doctype: fields for doctype, fields in pending.items() if fields}
	if not pending:
		return

	sync_customizations("afmco")

	for doctype, fields in pending.items():
		meta = frappe.get_meta(doctype, cached=False)
		for old, new in fields.items():
			if not meta.get_field(new):
				frappe.throw(f"{doctype}.{new} is not synced; {old} keeps its data")
			rename_field(doctype, old, new, validate=False)
			rewrite_db_callers(doctype, old, new)
			for name in frappe.get_all("Custom Field", {"dt": doctype, "fieldname": old}, pluck="name"):
				frappe.delete_doc("Custom Field", name, force=True)

		columns = [old for old in fields if frappe.db.has_column(doctype, old)]
		if columns:
			frappe.db.sql_ddl(
				f"ALTER TABLE `tab{doctype}` " + ", ".join(f"DROP COLUMN `{c}`" for c in columns)
			)
		frappe.clear_cache(doctype=doctype)


def is_pending(doctype, old):
	return frappe.db.has_column(doctype, old) or frappe.db.exists(
		"Custom Field", {"dt": doctype, "fieldname": old}
	)


def rewrite_db_callers(doctype, old, new):
	token = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(old)}(?![A-Za-z0-9_])")

	def sub_rows(table, column, filters):
		for name, value in frappe.get_all(
			table, filters={**filters, column: ("like", f"%{old}%")}, fields=["name", column], as_list=True
		):
			if token.search(value or ""):
				frappe.db.set_value(table, name, column, token.sub(new, value), update_modified=False)

	sub_rows("Property Setter", "value", {"doc_type": doctype, "property": "field_order"})
	sub_rows("List View Settings", "fields", {"name": doctype})

	workflows = frappe.get_all("Workflow", {"document_type": doctype}, pluck="name")
	if workflows:
		sub_rows("Workflow Transition", "condition", {"parent": ("in", workflows)})

	for table in ("Salary Component", "Salary Detail"):
		for column in ("formula", "condition"):
			sub_rows(table, column, {})

	for report in frappe.get_all(
		"Report",
		{"is_standard": "No", "report_type": "Query Report", "query": ("like", f"%tab{doctype}%")},
		pluck="name",
	):
		sub_rows("Report", "query", {"name": report})

	naming_rules = frappe.get_all("Document Naming Rule", {"document_type": doctype}, pluck="name")
	if naming_rules:
		frappe.db.set_value(
			"Document Naming Rule Condition",
			{"parent": ("in", naming_rules), "field": old},
			"field",
			new,
			update_modified=False,
		)

	if doctype == "Employee":
		frappe.db.set_value(
			"Employee Property History", {"fieldname": old}, "fieldname", new, update_modified=False
		)

	frappe.db.set_value(
		"DocType Link",
		{"link_doctype": doctype, "link_fieldname": old, "custom": 1},
		"link_fieldname",
		new,
		update_modified=False,
	)

	for table, parent_key in (("DocField", "parent"), ("Custom Field", "dt")):
		for name, parent, fetch_from in frappe.get_all(
			table,
			filters={"fetch_from": ("like", f"%.{old}")},
			fields=["name", parent_key, "fetch_from"],
			as_list=True,
		):
			link, fieldname = fetch_from.split(".", 1)
			link_field = frappe.get_meta(parent).get_field(link)
			if fieldname == old and link_field and link_field.options == doctype:
				frappe.db.set_value(table, name, "fetch_from", f"{link}.{new}", update_modified=False)
				frappe.clear_cache(doctype=parent)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

FIELDS = [
	"employee",
	"employee_name",
	"department",
	"corporation",
	"status",
	"iqama_expiration_date",
	"renewal_duration",
	"renewal_preference",
	"reason_of_not_renew",
	"sadad_invoice",
	"file_no",
	"iqama_renewal_amount",
	"total_amount",
	"posting_date",
	"company_name",
	"pr_status",
]

RENEWAL_PREFERENCE_COLORS = {"Yes": "green", "NO": "red"}

STATUS_COLORS = {
	"Renewed": "blue",
	"Awaiting Operations Approval": "orange",
	"Awaiting Payment": "purple",
	"Issue Preventing Renewal": "red",
	"Rejected": "darkred",
	"Rescheduled": "#FF8C00",
	"Waiting for Legal Approval": "#4B0082",
	"Awaiting Renewal": "#008B8B",
}


def execute(filters=None):
	results = frappe.get_all("Iqama Renewal Tracking", fields=FIELDS, filters=filters, order_by="employee ASC")
	status_chart = top_five_chart(results, "status")
	department_chart = top_five_chart(results, "department")
	for row in results:
		colorize(row, "renewal_preference", RENEWAL_PREFERENCE_COLORS)
		colorize(row, "status", STATUS_COLORS)
	return get_columns(), results, status_chart, department_chart


def top_five_chart(results, fieldname):
	counts = {}
	for row in results:
		value = row.get(fieldname)
		if value:
			counts[value] = counts.get(value, 0) + 1
	top = sorted(zip(counts.values(), counts.keys()), reverse=True)[:5]
	return {
		"data": {"labels": [label for _count, label in top], "datasets": [{"values": [count for count, _label in top]}]},
		"type": "bar",
		"height": 150,
	}


def colorize(row, fieldname, colors):
	color = colors.get(row.get(fieldname))
	if color:
		row[fieldname] = f'<span style="color: {color};">{row[fieldname]}</span>'


def get_columns():
	return [
		{"fieldname": "employee", "label": _("Employee"), "fieldtype": "Link", "options": "Employee", "width": 150},
		{"fieldname": "employee_name", "label": _("Employee Name"), "fieldtype": "Data", "width": 150},
		{"fieldname": "department", "label": _("Department"), "fieldtype": "Link", "options": "Department", "width": 150},
		{"fieldname": "corporation", "label": _("Corporation"), "fieldtype": "Link", "options": "Corporation", "width": 150},
		{"fieldname": "status", "label": _("Status"), "fieldtype": "Data", "width": 120},
		{"fieldname": "iqama_expiration_date", "label": _("Iqama Expiration Date"), "fieldtype": "Date", "width": 140},
		{"fieldname": "renewal_duration", "label": _("Renewal Duration"), "fieldtype": "Data", "width": 120},
		{"fieldname": "renewal_preference", "label": _("Renewal Preference"), "fieldtype": "Data", "width": 120},
		{"fieldname": "reason_of_not_renew", "label": _("Reason of Not Renewal"), "fieldtype": "Data", "width": 150},
		{"fieldname": "posting_date", "label": _("Posting Date"), "fieldtype": "Date", "width": 120},
		{"fieldname": "sadad_invoice", "label": _("SADAD Invoice"), "fieldtype": "Data", "width": 150},
		{"fieldname": "file_no", "label": _("File No"), "fieldtype": "Data", "width": 120},
		{"fieldname": "pr_status", "label": _("PR Status"), "fieldtype": "Data", "width": 180},
		{"fieldname": "iqama_renewal_amount", "label": _("Iqama Renewal Amount"), "fieldtype": "Currency", "width": 160},
		{"fieldname": "total_amount", "label": _("Total Amount"), "fieldtype": "Currency", "width": 150},
		{"fieldname": "company_name", "label": _("Company Name"), "fieldtype": "Data", "width": 150},
	]

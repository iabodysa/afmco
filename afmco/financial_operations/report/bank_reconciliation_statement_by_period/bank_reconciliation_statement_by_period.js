// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

{% include "erpnext/accounts/report/bank_reconciliation_statement/bank_reconciliation_statement.js" %}

frappe.query_reports["Bank Reconciliation Statement by Period"] = {
	...frappe.query_reports["Bank Reconciliation Statement"],
	filters: frappe.query_reports["Bank Reconciliation Statement"].filters.flatMap((filter) =>
		filter.fieldname === "report_date"
			? [
					{
						fieldname: "from_date",
						label: __("From Date"),
						fieldtype: "Date",
						default: frappe.datetime.add_months(frappe.datetime.get_today(), -12),
					},
					{ ...filter, label: __("To Date") },
			  ]
			: [filter]
	),
};

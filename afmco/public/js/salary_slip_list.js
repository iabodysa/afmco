// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.listview_settings["Salary Slip"] = frappe.listview_settings["Salary Slip"] || {};

(function (settings) {
	const hrms_onload = settings.onload;

	settings.onload = function (listview) {
		if (hrms_onload) hrms_onload.call(this, listview);

		listview.page.add_action_item(__("Salary Slip Custom (Excel)"), () => {
			const docnames = listview.get_checked_items(true);
			if (!docnames.length) {
				frappe.msgprint(__("Please check at least one row to export."));
				return;
			}

			frappe.msgprint(__("Generating Excel export for {0} records...", [docnames.length]));
			open_url_post("/api/method/frappe.desk.reportview.export_query", {
				doctype: "Salary Slip",
				title: "Custom_Payroll_Export",
				file_format_type: "Excel",
				view: "Report",
				fields: JSON.stringify([
					"name",
					"posting_date",
					"department",
					"employee",
					"employee_name",
					"start_date",
					"end_date",
					"gross_pay",
					"loans_amount",
					"total_deduction",
					"net_pay",
					"bank_name",
					"bank_account_no",
				]),
				filters: JSON.stringify([["Salary Slip", "name", "in", docnames]]),
			});
		});
	};
})(frappe.listview_settings["Salary Slip"]);

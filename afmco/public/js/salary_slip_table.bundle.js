// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

import "./salary_slip_table.html";

frappe.provide("afmco.salary_slip_table");

afmco.salary_slip_table.print = function (filters, subtitle) {
	frappe.model.with_doctype("Salary Slip", () => print_table(filters, subtitle));
};

function print_table(filters, subtitle) {
	const has_loan = !!frappe.meta.get_docfield("Salary Slip", "total_loan_repayment");
	const columns = [
		{ fieldname: "employee" },
		{ fieldname: "employee_name" },
		{ fieldname: "department" },
		{ fieldname: "gross_pay", numeric: true },
		{ fieldname: "total_deduction", numeric: true },
		has_loan && { fieldname: "total_loan_repayment", numeric: true },
		{ fieldname: "net_pay", numeric: true },
		{ fieldname: "bank_account_no" },
		{ fieldname: "hold" },
	].filter(Boolean);
	columns.forEach((col) => {
		col.label = __(frappe.meta.get_label("Salary Slip", col.fieldname));
	});

	const fields = columns
		.map((col) => col.fieldname)
		.concat(["start_date", "end_date", "currency"]);

	frappe
		.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Salary Slip",
				fields: fields,
				filters: filters,
				order_by: "employee_name asc",
				limit_page_length: 0,
			},
		})
		.then((r) => {
			const slips = r.message || [];
			if (!slips.length) {
				frappe.msgprint(__("No Salary Slip found"));
				return;
			}
			const currency = slips[0].currency;
			const money = (value) => format_currency(value, currency);
			const periods = [
				...new Set(
					slips.map((slip) =>
						__("{0} to {1}", [
							frappe.datetime.str_to_user(slip.start_date),
							frappe.datetime.str_to_user(slip.end_date),
						])
					)
				),
			];
			const cell = (slip, col) => {
				if (col.fieldname === "hold") {
					return slip.hold ? __("Hold") : "";
				}
				return col.numeric
					? money(slip[col.fieldname])
					: frappe.utils.escape_html(slip[col.fieldname] || "");
			};
			const rows = slips.map((slip) => columns.map((col) => cell(slip, col)));
			const totals = columns.map((col) =>
				col.numeric ? money(slips.reduce((sum, slip) => sum + flt(slip[col.fieldname]), 0)) : ""
			);

			frappe.ui.get_print_settings(false, (print_settings) => {
				frappe.render_grid({
					template: "salary_slip_table",
					title: __("Salary Slips"),
					subtitles: [subtitle, ...periods].filter(Boolean),
					columns: columns,
					rows: rows,
					totals: totals,
					print_settings: print_settings,
				});
			});
		});
}

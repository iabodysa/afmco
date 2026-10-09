// Copyright (c) 2026, AFMCO and contributors

const WPS_API = "afmco.people_and_payroll.api.wps_file";
const WPS_REGISTER_FORMAT = "Salary Register WPS";
const WPS_AMOUNTS = ["net_pay", "basic33", "housing33", "other_allowance33", "deduction33"];
const WPS_COLUMNS = [
	["name", __("Salary Slip", null, "WPS File")],
	["bank_name", __("Bank", null, "WPS File")],
	["bank_account_no", __("IBAN", null, "WPS File")],
	["net_pay", __("Total Salary", null, "WPS File")],
	["remark", __("Remark", null, "WPS File")],
	["employee_name", __("Employee Name", null, "WPS File")],
	["employee", __("ID", null, "WPS File")],
	["branch", __("Address", null, "WPS File")],
	["basic33", __("Basic salary", null, "WPS File")],
	["housing33", __("Housing", null, "WPS File")],
	["other_allowance33", __("Other allowances", null, "WPS File")],
	["deduction33", __("Deductions", null, "WPS File")],
];

frappe.pages["wps-file"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("WPS Salary File", null, "WPS File"),
		single_column: true,
	});
	wrapper.wps_file = new WpsFile(page);
};

class WpsFile {
	constructor(page) {
		this.page = page;
		this.result = null;
		this.issued = null;
		this.$root = $('<div class="wps-file"></div>').appendTo(page.main);
		this.make_filters();
		this.file_format = this.page.add_field({
			fieldname: "file_format",
			label: __("File Format", null, "WPS File"),
			fieldtype: "Select",
			options: [WPS_REGISTER_FORMAT, "NCBK", "SIBC"].join("\n"),
			default: WPS_REGISTER_FORMAT,
			reqd: 1,
		});
		this.page.set_primary_action(__("Issue WPS file", null, "WPS File"), () => this.issue(), "download");
		this.page.set_secondary_action(__("Refresh", null, "WPS File"), () => this.load());
		this.page.add_inner_button(__("Copy Email Body", null, "WPS File"), () => this.show_email());
		this.load();
	}

	make_filters() {
		const reload = () => this.load();
		this.filters = {
			company: this.page.add_field({
				fieldname: "company",
				label: __("Company", null, "WPS File"),
				fieldtype: "Link",
				options: "Company",
				reqd: 1,
				default: frappe.defaults.get_user_default("Company"),
				change: reload,
			}),
			from_date: this.page.add_field({
				fieldname: "from_date",
				label: __("From Date", null, "WPS File"),
				fieldtype: "Date",
				reqd: 1,
				default: frappe.datetime.month_start(),
				change: reload,
			}),
			to_date: this.page.add_field({
				fieldname: "to_date",
				label: __("To Date", null, "WPS File"),
				fieldtype: "Date",
				reqd: 1,
				default: frappe.datetime.month_end(),
				change: reload,
			}),
			payroll_entry: this.page.add_field({
				fieldname: "payroll_entry",
				label: __("Payroll Entry", null, "WPS File"),
				fieldtype: "Link",
				options: "Payroll Entry",
				get_query: () => ({
					filters: { company: this.filters.company.get_value(), docstatus: 1 },
				}),
				change: reload,
			}),
			bank_name: this.page.add_field({
				fieldname: "bank_name",
				label: __("Bank", null, "WPS File"),
				fieldtype: "Data",
				change: reload,
			}),
		};
	}

	args() {
		const args = {};
		Object.entries(this.filters).forEach(([fieldname, field]) => {
			const value = field.get_value();
			if (value) {
				args[fieldname] = value;
			}
		});
		return args;
	}

	ready(args) {
		return args.company && args.from_date && args.to_date;
	}

	load() {
		const args = this.args();
		this.result = null;
		this.issued = null;
		if (!this.ready(args)) {
			this.render_message(__("Select a company and a date range", null, "WPS File"));
			return;
		}
		frappe
			.call({ method: `${WPS_API}.preview`, type: "GET", args, freeze: true })
			.then((r) => {
				this.result = r.message;
				this.render();
			});
	}

	render_message(text) {
		this.$root.html(`<div class="wps-file-empty">${frappe.utils.escape_html(text)}</div>`);
	}

	render() {
		const { rows, problems } = this.result;
		if (!rows.length) {
			this.render_message(__("No submitted salary slips match these filters", null, "WPS File"));
			return;
		}
		this.$root.html(`${this.summary_html(rows, problems)}${this.problems_html(problems)}${this.table_html(rows)}`);
	}

	summary_html(rows, problems) {
		const total = rows.reduce((sum, row) => sum + flt(row.net_pay), 0);
		const state = problems.length
			? `<span class="indicator-pill red">${__("{0} open checks", [problems.length], "WPS File")}</span>`
			: `<span class="indicator-pill green">${__("Ready to issue", null, "WPS File")}</span>`;
		return `<div class="wps-file-summary">
			<div><span class="wps-file-label">${__("Employees", null, "WPS File")}</span><b>${rows.length}</b></div>
			<div><span class="wps-file-label">${__("Total Salary", null, "WPS File")}</span><b>${format_number(total, null, 2)}</b></div>
			<div>${state}</div>
		</div>`;
	}

	problems_html(problems) {
		if (!problems.length) {
			return "";
		}
		const items = problems
			.map(
				(problem) => `<li>
					<a href="${frappe.utils.get_form_link("Salary Slip", problem.salary_slip)}">${frappe.utils.escape_html(problem.salary_slip)}</a>
					<span>${frappe.utils.escape_html(problem.employee_name || problem.employee)}</span>
					<span class="wps-file-problem">${frappe.utils.escape_html(problem.message)}</span>
				</li>`
			)
			.join("");
		return `<div class="wps-file-problems">
			<div class="wps-file-heading">${__("Checks to resolve before issuing", null, "WPS File")}</div>
			<ul>${items}</ul>
		</div>`;
	}

	table_html(rows) {
		const flagged = new Set(this.result.problems.map((problem) => problem.salary_slip));
		const head = WPS_COLUMNS.map(([, label]) => `<th>${frappe.utils.escape_html(label)}</th>`).join("");
		const body = rows
			.map((row) => {
				const cells = WPS_COLUMNS.map(([fieldname]) => `<td>${this.cell(row, fieldname)}</td>`).join("");
				return `<tr class="${flagged.has(row.name) ? "wps-file-flagged" : ""}">${cells}</tr>`;
			})
			.join("");
		const totals = WPS_COLUMNS.map(([fieldname], index) => {
			if (WPS_AMOUNTS.includes(fieldname)) {
				const sum = rows.reduce((total, row) => total + flt(row[fieldname]), 0);
				return `<td>${format_number(sum, null, 2)}</td>`;
			}
			return `<td>${index === 0 ? __("Total", null, "WPS File") : ""}</td>`;
		}).join("");
		return `<div class="wps-file-grid"><table>
			<thead><tr>${head}</tr></thead>
			<tbody>${body}</tbody>
			<tfoot><tr>${totals}</tr></tfoot>
		</table></div>`;
	}

	cell(row, fieldname) {
		const value = row[fieldname];
		if (fieldname === "name") {
			return `<a href="${frappe.utils.get_form_link("Salary Slip", value)}">${frappe.utils.escape_html(value)}</a>`;
		}
		if (WPS_AMOUNTS.includes(fieldname)) {
			return format_number(value, null, 2);
		}
		return frappe.utils.escape_html(value || "");
	}

	issue() {
		const args = this.args();
		args.file_format = this.file_format.get_value();
		if (!this.ready(args)) {
			frappe.msgprint(__("Select a company and a date range", null, "WPS File"));
			return;
		}
		frappe.call({ method: `${WPS_API}.download`, type: "GET", args, freeze: true }).then((r) => {
			this.issued = { filename: r.message.filename, file_format: args.file_format };
			const blob = new Blob([r.message.content], { type: "text/csv;charset=utf-8;" });
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = r.message.filename;
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(link.href);
		});
	}

	show_email() {
		if (!this.issued || !this.result) {
			frappe.msgprint(__("Issue the WPS file first", null, "WPS File"));
			return;
		}
		const body = this.email_body();
		const copy = () =>
			frappe.utils.copy_to_clipboard(body, __("Email body copied to clipboard", null, "WPS File"));
		const dialog = new frappe.ui.Dialog({
			title: __("Email Body", null, "WPS File"),
			size: "large",
			fields: [{ fieldtype: "HTML", fieldname: "body" }],
			primary_action_label: __("Copy", null, "WPS File"),
			primary_action: copy,
		});
		dialog.fields_dict.body.$wrapper.html(
			`<pre class="wps-file-email">${frappe.utils.escape_html(body)}</pre>`
		);
		dialog.show();
		copy();
	}

	email_body() {
		const { files, hold, employees_count, total_net_pay } = this.result.groups;
		const args = this.args();
		const sar = new Intl.NumberFormat("en-SA", {
			style: "currency",
			currency: "SAR",
			minimumFractionDigits: 2,
		});
		const bank =
			args.bank_name ||
			(this.issued.file_format === WPS_REGISTER_FORMAT ? "Bank" : this.issued.file_format);
		const reference = args.payroll_entry || `${args.from_date} - ${args.to_date}`;
		const rows = files.map((file) =>
			[
				file.labor_office_file_number ? `1 - ${file.labor_office_file_number}` : "N/A",
				file.corporation_cr || "-",
				file.employees_count,
				sar.format(file.total_net_pay),
			].join(" | ")
		);
		const lines = [
			`Dear ${bank} Representative,`,
			"",
			`Please find attached the WPS file for payroll processing (${reference}). Below is a summary of the file:`,
			"",
			"MOL No. | CR | Count | Total Amount",
			...rows,
			`Grand Total | ${files.length} | ${employees_count} | ${sar.format(total_net_pay)}`,
			"",
		];
		if (hold.employees_count) {
			lines.push(
				`Hold Information: ${hold.employees_count} employees (${sar.format(
					hold.total_net_pay
				)}) are on hold. Their salary slips are included in the attached file and excluded from the Grand Total above.`,
				`Attached File Total | ${employees_count + hold.employees_count} | ${sar.format(
					total_net_pay + hold.total_net_pay
				)}`,
				""
			);
		}
		lines.push(
			`File: ${this.issued.filename}`,
			"",
			"Important: Please double-check the totals before uploading to the bank system.",
			"",
			`For any bank account updates, please use: ${frappe.urllib.get_full_url("/desk/iban-update")}`,
			"",
			"Best regards,",
			"WPS Payroll Unit"
		);
		return lines.join("\n");
	}
}

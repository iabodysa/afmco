// Copyright (c) 2026, AFMCO and contributors

const EIC_API = "afmco.people_and_payroll.api.employee_id_checker.analyze";
const EIC_EXPORT_API = "afmco.people_and_payroll.api.employee_id_checker.export_xlsx";
const EIC_COLUMNS = [
	["employee", __("Employee ID"), "Employee ID"],
	["employee_name", __("Employee Name"), "Name"],
	["nationality", __("Nationality"), "Nationality"],
	["status", __("Status"), "Status"],
	["department", __("Department"), "Department"],
	["payroll_cost_center", __("Cost Center"), "Cost Center"],
	["branch", __("Branch"), "Branch"],
	["labor_office_file_number", __("Labor File No."), "Labor File No."],
	["iqama_expiration_date", __("Iqama Expiry"), "Iqama Expiry"],
	["iqama_expired_flag", __("Expired?"), "Expired?"],
	["iqama_expired_days", __("Days"), "Days"],
	["iqama_expired_months", __("Months"), "Months"],
	["iqama_expired_years", __("Years"), "Years"],
	["last_salary_date", __("Last Salary Date"), "Last Salary Date"],
	["last_salary_amount", __("Last Salary Amount"), "Last Salary Amount"],
];

frappe.pages["employee-id-checker"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __("Employee ID Checker"),
		single_column: true,
	});
	wrapper.employee_id_checker = new EmployeeIdChecker(page);
};

class EmployeeIdChecker {
	constructor(page) {
		this.page = page;
		this.rows = [];
		this.sort = { column: null, direction: "asc" };
		this.$root = $('<div class="employee-id-checker"></div>').appendTo(page.main);
		this.form = new frappe.ui.FieldGroup({
			fields: [{ fieldname: "employee_ids", fieldtype: "Small Text", label: __("Employee IDs") }],
			body: $("<div></div>").appendTo(this.$root),
		});
		this.form.make();
		this.$results = $("<div></div>").appendTo(this.$root);
		this.page.set_primary_action(__("🔍 Analyze Employees"), () => this.analyze());
	}

	async analyze() {
		const raw_employee_ids = (this.form.get_value("employee_ids") || "").trim();
		if (!raw_employee_ids) {
			frappe.msgprint({
				title: __("Input Required"),
				message: __("Please enter Employee IDs first."),
				indicator: "orange",
			});
			return;
		}
		const employee_ids = raw_employee_ids
			.split(/[\n,]+/)
			.map((v) => v.trim())
			.filter((v) => v);
		if (!employee_ids.length) {
			frappe.msgprint({
				title: __("Input Required"),
				message: __("No valid Employee IDs found after parsing."),
				indicator: "orange",
			});
			return;
		}

		const total = employee_ids.length;
		const { message: employees = [] } = await frappe.call({
			method: EIC_API,
			args: { employee_ids },
			freeze: true,
			freeze_message: __("Analyzing Employees..."),
		});

		const today = frappe.datetime.now_date();
		const by_id = new Map(employees.map((emp) => [emp.name.toLowerCase(), emp]));
		this.rows = employee_ids.map((emp_id) => this.make_row(emp_id, by_id.get(emp_id.toLowerCase()), today));
		this.sort = { column: null, direction: "asc" };
		this.render(today);

		const found = this.rows.filter((r) => r.is_found).length;
		frappe.show_alert({
			message: __("✅ Employee analysis complete. {0} records processed, {1} found.", [total, found]),
			indicator: "green",
		});
	}

	make_row(emp_id, emp, today) {
		const row = {
			employee: emp_id,
			employee_name: __("Not Found"),
			nationality: "-",
			status: "-",
			department: "-",
			payroll_cost_center: "-",
			branch: "-",
			labor_office_file_number: "-",
			iqama_expiration_date: "-",
			iqama_expired_flag: false,
			iqama_expired_days: "-",
			iqama_expired_months: "-",
			iqama_expired_years: "-",
			last_salary_date: "-",
			last_salary_amount: "-",
			is_found: false,
		};
		if (!emp) return row;

		Object.assign(row, {
			is_found: true,
			employee_name: emp.employee_name || emp.first_name || "(No Name)",
			nationality: emp.nationality || "-",
			status: emp.status || "-",
			department: emp.department || "-",
			payroll_cost_center: emp.payroll_cost_center || "-",
			branch: emp.branch || "-",
			labor_office_file_number: emp.labor_office_file_number || "-",
		});
		if (emp.iqama_expiration_date) {
			row.iqama_expiration_date = frappe.datetime.str_to_user(emp.iqama_expiration_date);
			const days = frappe.datetime.get_diff(today, emp.iqama_expiration_date);
			if (days > 0) {
				Object.assign(row, {
					iqama_expired_flag: true,
					iqama_expired_days: days,
					iqama_expired_months: parseFloat((days / 30).toFixed(1)),
					iqama_expired_years: parseFloat((days / 365).toFixed(2)),
				});
			}
		}
		const salary = emp.last_salary;
		if (salary) {
			row.last_salary_date = salary.posting_date ? frappe.datetime.str_to_user(salary.posting_date) : "-";
			row.last_salary_amount = salary.net_pay
				? format_currency(salary.net_pay, salary.currency || "SAR")
				: "-";
		}
		return row;
	}

	render(today) {
		const total = this.rows.length;
		const found = this.rows.filter((r) => r.is_found).length;
		const expired = this.rows.filter((r) => r.iqama_expired_flag).length;
		const esc = frappe.utils.escape_html;
		const stat = (css, number, label) =>
			`<div class="stat-card ${css}"><div class="stat-number">${number}</div><div class="stat-label">${label}</div></div>`;
		const head = EIC_COLUMNS.map(
			([column, label]) =>
				`<th class="sortable${column === "last_salary_amount" ? " text-end" : ""}" data-column="${column}">${esc(label)}</th>`
		).join("");

		this.$results.html(`
			<div class="analysis-container">
				<div class="analysis-header">
					<div>
						<h3 class="analysis-title">📊 ${esc(__("Employee Analysis Report"))}</h3>
						<p class="analysis-date">${esc(__("Generated on"))} ${frappe.datetime.str_to_user(today)}</p>
					</div>
					<div class="analysis-total">
						<div class="analysis-total-number">${total}</div>
						<div class="analysis-total-label">${esc(__("Total Records"))}</div>
					</div>
				</div>
				<div class="analysis-stats">
					${stat("stat-found", `<span class="text-success">${found}</span>`, esc(__("Found")))}
					${stat("stat-missing", `<span class="text-danger">${total - found}</span>`, esc(__("Not Found")))}
					${stat("stat-expired", expired, esc(__("Expired Iqama")))}
					${stat("stat-rate", `${Math.round((found / total) * 100)}%`, esc(__("Success Rate")))}
				</div>
				<div class="table-controls">
					<div class="search-box">
						<input type="text" class="search-input" autocomplete="off" placeholder="${esc(__("Search employees..."))}">
					</div>
					<button class="export-btn">📄 ${esc(__("Export CSV"))}</button>
					<button class="export-btn export-xlsx-btn">📊 ${esc(__("Export Excel"))}</button>
				</div>
				<div class="table-wrapper">
					<div class="table-scroll">
						<table class="results-table">
							<thead><tr>${head}</tr></thead>
							<tbody></tbody>
						</table>
					</div>
				</div>
			</div>`);

		this.$results.find(".search-input").on("input", () => this.filter());
		this.$results.find(".export-btn:not(.export-xlsx-btn)").on("click", () => this.export_csv());
		this.$results.find(".export-xlsx-btn").on("click", () => this.export_xlsx());
		this.$results.find("th.sortable").on("click", (e) => this.sort_by($(e.currentTarget)));
		this.render_body();
	}

	render_body() {
		const esc = frappe.utils.escape_html;
		const $tbody = this.$results.find("tbody");
		if (!this.rows.length) {
			$tbody.html(`<tr><td colspan="${EIC_COLUMNS.length}" class="no-data-row">${esc(__("No data found."))}</td></tr>`);
			return;
		}
		$tbody.html(
			this.rows
				.map((r) => {
					const row_class = !r.is_found ? "not-found" : r.iqama_expired_flag ? "expired-iqama" : "";
					const name = r.is_found
						? esc(r.employee_name)
						: `<i class="text-muted">${esc(r.employee_name)}</i>`;
					const expired =
						r.is_found && r.iqama_expiration_date !== "-"
							? r.iqama_expired_flag
								? '<span class="result-badge expired-yes">⚠️ Yes</span>'
								: '<span class="result-badge expired-no">✅ No</span>'
							: "-";
					const status =
						r.status !== "-"
							? `<span class="result-badge status-${esc(r.status.toLowerCase())}">${esc(r.status)}</span>`
							: "-";
					const search = [r.employee, r.employee_name, r.department, r.nationality].join(" ").toLowerCase();
					return `<tr class="${row_class}" data-search="${esc(search)}">
						<td><strong>${esc(r.employee)}</strong></td>
						<td>${name}</td>
						<td>${esc(r.nationality)}</td>
						<td>${status}</td>
						<td>${esc(r.department)}</td>
						<td>${esc(r.payroll_cost_center)}</td>
						<td>${esc(r.branch)}</td>
						<td>${esc(r.labor_office_file_number)}</td>
						<td>${esc(r.iqama_expiration_date)}</td>
						<td>${expired}</td>
						<td>${r.iqama_expired_days}</td>
						<td>${r.iqama_expired_months}</td>
						<td>${r.iqama_expired_years}</td>
						<td>${esc(r.last_salary_date)}</td>
						<td class="text-end"><strong>${esc(r.last_salary_amount)}</strong></td>
					</tr>`;
				})
				.join("")
		);
		this.filter();
	}

	filter() {
		const term = (this.$results.find(".search-input").val() || "").toLowerCase();
		this.$results.find("tbody tr[data-search]").each(function () {
			$(this).toggle(($(this).attr("data-search") || "").includes(term));
		});
	}

	sort_by($th) {
		const column = $th.data("column");
		this.sort =
			this.sort.column === column
				? { column, direction: this.sort.direction === "asc" ? "desc" : "asc" }
				: { column, direction: "asc" };
		this.$results.find("th.sortable").removeClass("sort-asc sort-desc");
		$th.addClass(`sort-${this.sort.direction}`);

		const direction = this.sort.direction === "asc" ? 1 : -1;
		this.rows.sort((a, b) => {
			let x = a[column] === "-" || a[column] === "" ? "" : a[column];
			let y = b[column] === "-" || b[column] === "" ? "" : b[column];
			if (!isNaN(x) && !isNaN(y)) {
				x = parseFloat(x);
				y = parseFloat(y);
			} else {
				x = String(x).toLowerCase();
				y = String(y).toLowerCase();
			}
			return (x > y ? 1 : -1) * direction;
		});
		this.render_body();
	}

	table_data() {
		return [EIC_COLUMNS.map(([, , header]) => header)].concat(
			this.rows.map((r) =>
				EIC_COLUMNS.map(([column]) =>
					column === "iqama_expired_flag" ? (r[column] ? "Yes" : "No") : r[column]
				)
			)
		);
	}

	export_csv() {
		frappe.tools.downloadify(this.table_data(), null, `employee_analysis_${frappe.datetime.now_date()}`);
	}

	export_xlsx() {
		open_url_post(frappe.request.url, { cmd: EIC_EXPORT_API, rows: this.table_data() });
	}
}

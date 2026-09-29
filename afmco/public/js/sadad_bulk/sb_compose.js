// Copyright (c) 2026, AFMCO and contributors

class SadadComposeView {
	constructor(app) {
		this.app = app;
		this.store = app.store;
	}

	async render($container) {
		this.$el = $(`
			<div class="sb-compose">
				<ol class="sb-steps"></ol>
				<section class="sb-compose-body"></section>
			</div>
		`).appendTo($container);
		await this.store.load_setup();
		this.render_inputs();
	}

	steps(active) {
		const steps = ["step_inputs", "step_preview", "step_add"];
		this.$el.find(".sb-steps").html(
			steps
				.map(
					(key, index) =>
						`<li class="sb-step" aria-current="${index === active}"><span class="sb-num">${
							index + 1
						}</span> ${sb_esc(sb_t(key))}</li>`
				)
				.join("")
		);
	}

	render_inputs() {
		this.steps(0);
		const compose = this.store.compose;
		const types = this.store
			.fee_types()
			.map(
				(type) =>
					`<option value="${sb_esc(type)}" ${type === compose.fee_type ? "selected" : ""}>${sb_esc(
						__(type)
					)}</option>`
			)
			.join("");
		const $body = this.$el.find(".sb-compose-body").html(`
			<div class="sb-form">
				<label class="sb-label">${sb_esc(sb_t("fee_type"))}
					<span class="frappe-control sb-select" data-fieldtype="Select"><span class="control-input">
						<select class="form-control" data-field="fee_type">
							<option value="">${sb_esc(sb_t("select_type"))}</option>${types}
						</select>
						<span class="select-icon">${frappe.utils.icon("select", "sm")}</span>
					</span></span>
				</label>
				<label class="sb-label">${sb_esc(sb_t("period"))}
					<span class="frappe-control sb-select" data-fieldtype="Select"><span class="control-input">
						<select class="form-control" data-field="period"></select>
						<span class="select-icon">${frappe.utils.icon("select", "sm")}</span>
					</span></span>
				</label>
				<label class="sb-label">${sb_esc(sb_t("bank_payment_date"))}
					<input type="date" class="form-control" data-field="bank_payment_date"
						value="${sb_esc(compose.bank_payment_date)}">
				</label>
				<label class="sb-label">${sb_esc(sb_t("invoice"))}
					<input type="text" inputmode="numeric" class="form-control" data-field="sadad_invoice_number"
						value="${sb_esc(compose.sadad_invoice_number)}">
				</label>
				<div class="sb-label sb-batch-field"></div>
				<label class="sb-label sb-wide">${sb_esc(sb_t("employees_list"))}
					<textarea class="form-control sb-ids" rows="8" data-field="employees">${sb_esc(
						compose.employees
					)}</textarea>
				</label>
				<div class="sb-fee text-muted"></div>
			</div>
			<div class="sb-actions">
				<button type="button" class="btn btn-primary btn-sm" data-step="preview">${sb_esc(
					sb_t("act_preview")
				)}</button>
			</div>
		`);
		this.batch_control = frappe.ui.form.make_control({
			parent: $body.find(".sb-batch-field"),
			df: {
				fieldtype: "Link",
				fieldname: "batch",
				options: SB_DOCTYPE,
				label: sb_t("target_batch"),
				get_query: () => ({ filters: { docstatus: 0 } }),
				change: () => {
					compose.batch = this.batch_control.get_value() || "";
				},
			},
			render_input: true,
		});
		this.batch_control.set_value(compose.batch);
		$body.find("[data-field]").on("change input", (event) => {
			const field = $(event.currentTarget).data("field");
			compose[field] = event.target.value;
			if (field === "fee_type") {
				compose.period = "";
				this.fill_periods();
			}
			this.show_fee();
		});
		$body.find("[data-step=preview]").on("click", () => this.preview());
		this.fill_periods();
		this.show_fee();
	}

	fill_periods() {
		const compose = this.store.compose;
		const rows = this.store.periods(compose.fee_type);
		if (rows.length === 1) {
			compose.period = String(rows[0].period);
		}
		const options = rows
			.map(
				(row) =>
					`<option value="${row.period}" ${String(row.period) === compose.period ? "selected" : ""}>${sb_esc(
						sb_t(`period_${row.period_unit || "Month"}`, row.period)
					)}</option>`
			)
			.join("");
		this.$el
			.find("[data-field=period]")
			.html(`<option value="">${sb_esc(sb_t("select_period"))}</option>${options}`);
	}

	show_fee() {
		const compose = this.store.compose;
		const row = this.store
			.periods(compose.fee_type)
			.find((item) => String(item.period) === String(compose.period));
		this.$el
			.find(".sb-fee")
			.html(row ? `${sb_esc(sb_t("fee_amount"))}: <span class="sb-num">${sb_money(row.amounts)}</span>` : "");
	}

	async preview() {
		const preview = await this.store.run_preview();
		this.steps(1);
		const blocking = preview.issues.filter((issue) => issue.blocking);
		const by_employee = {};
		preview.issues.forEach((issue) => {
			(by_employee[issue.employee] = by_employee[issue.employee] || []).push(issue);
		});
		const groups = {};
		preview.lines.forEach((line) => {
			const group = (groups[line.employee] = groups[line.employee] || { line, debits: [], credit: 0 });
			if (line.credit) {
				group.credit = line.credit;
			} else {
				group.debits.push(line);
			}
		});
		const rows = Object.values(groups)
			.map(
				(group) => `
				<tr>
					<td><strong>${sb_esc(group.line.employee)}</strong><div class="text-muted">${sb_esc(
						group.line.employee_name
					)}</div></td>
					<td>${sb_esc(group.line.cost_center)}</td>
					<td>${group.debits
						.map(
							(line) =>
								`<div class="sb-seg-line"><span class="sb-num">${sb_esc(line.year)}</span>
								<span class="sb-num">${sb_money(line.debit)}</span>
								<span class="${line.account ? "text-muted" : "text-danger"}">${sb_esc(
									line.account || sb_t("missing_account")
								)}</span></div>`
						)
						.join("")}</td>
					<td class="sb-num">${sb_money(group.credit)}</td>
					<td>${this.issues_html(by_employee[group.line.employee])}</td>
				</tr>`
			)
			.join("");
		const orphans = Object.keys(by_employee)
			.filter((employee) => !groups[employee])
			.map(
				(employee) =>
					`<tr><td><strong>${sb_esc(employee)}</strong></td><td></td><td></td><td></td>
					<td>${this.issues_html(by_employee[employee])}</td></tr>`
			)
			.join("");
		const $body = this.$el.find(".sb-compose-body").html(`
			<div class="sb-facts">
				<span>${sb_esc(__(preview.setup.type))} · ${sb_esc(preview.setup.types_arabic)}</span>
				<span class="sb-num">${sb_esc(sb_date(preview.start))} – ${sb_esc(sb_date(preview.end))}</span>
				<span>${sb_esc(sb_t("preview_summary", preview.employees, sb_money(preview.total)))}</span>
			</div>
			<div class="sb-table-wrap"><table class="table table-sm sb-table">
				<thead><tr>
					<th>${sb_esc(sb_t("employee"))}</th><th>${sb_esc(sb_t("cost_center"))}</th>
					<th>${sb_esc(sb_t("segments"))}</th><th class="sb-num">${sb_esc(sb_t("credit"))}</th>
					<th>${sb_esc(sb_t("issues"))}</th>
				</tr></thead>
				<tbody>${rows}${orphans}</tbody>
			</table></div>
			${blocking.length ? `<div class="sb-note sb-note-danger">${sb_esc(sb_t("blocking_note"))}</div>` : ""}
			<div class="sb-actions">
				<button type="button" class="btn btn-default btn-sm" data-step="back">${sb_esc(sb_t("act_back"))}</button>
				<button type="button" class="btn btn-primary btn-sm" data-step="add"
					${blocking.length || !preview.employees ? "disabled" : ""}>${sb_esc(sb_t("act_add"))}</button>
			</div>
		`);
		$body.find("[data-step=back]").on("click", () => this.render_inputs());
		$body.find("[data-step=add]").on("click", () => this.add());
	}

	issues_html(issues) {
		return (issues || [])
			.map(
				(issue) =>
					`<div class="${issue.blocking ? "text-danger" : "text-warning"}">${sb_esc(
						sb_t(issue.blocking ? "blocking" : "warning")
					)}: ${sb_esc(issue.message)}</div>`
			)
			.join("");
	}

	async add() {
		const result = await this.store.add_lines();
		this.steps(2);
		const $body = this.$el.find(".sb-compose-body").html(`
			<div class="sb-outcome">
				<p>${sb_esc(sb_t("added_msg", result.employees, result.name))}</p>
				<div class="sb-actions">
					<button type="button" class="btn btn-primary btn-sm" data-step="open">${sb_esc(
						sb_t("open_batch")
					)}</button>
					<button type="button" class="btn btn-default btn-sm" data-step="more">${sb_esc(
						sb_t("act_add_lines")
					)}</button>
				</div>
			</div>
		`);
		$body.find("[data-step=open]").on("click", () => {
			this.store.current = result.name;
			this.app.show("batches");
		});
		$body.find("[data-step=more]").on("click", () => this.app.compose(result.name));
	}
}

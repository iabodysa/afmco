// Copyright (c) 2026, AFMCO and contributors

class SadadBatchesView {
	constructor(app) {
		this.app = app;
		this.store = app.store;
	}

	render($container) {
		this.$el = $(`
			<div class="sb-batches">
				<aside class="sb-rail"></aside>
				<section class="sb-list"></section>
				<section class="sb-detail"></section>
			</div>
		`).appendTo($container);
		this.render_rail();
		this.$el.find(".sb-detail").html(this.placeholder("pick_batch"));
		this.load();
		if (this.store.current) {
			this.open(this.store.current);
		}
	}

	placeholder(key) {
		return `<div class="sb-empty text-muted">${sb_esc(sb_t(key))}</div>`;
	}

	render_rail() {
		const filters = this.store.filters;
		const chips = SB_DOCSTATUS_FILTERS.map(
			(item) =>
				`<button type="button" class="sb-seg-btn" data-docstatus="${item.value}" aria-pressed="${
					item.value === filters.docstatus
				}">${sb_esc(sb_t(item.label))}</button>`
		).join("");
		const $rail = this.$el.find(".sb-rail").html(`
			<div class="sb-seg sb-seg-wrap" role="group">${chips}</div>
			<input type="search" class="form-control sb-search" placeholder="${sb_esc(sb_t("search"))}"
				value="${sb_esc(filters.search)}">
			<label class="sb-label">${sb_esc(sb_t("from_date"))}
				<input type="date" class="form-control" data-filter="from_date" value="${sb_esc(filters.from_date)}">
			</label>
			<label class="sb-label">${sb_esc(sb_t("to_date"))}
				<input type="date" class="form-control" data-filter="to_date" value="${sb_esc(filters.to_date)}">
			</label>
		`);
		$rail.find("[data-docstatus]").on("click", (event) => {
			filters.docstatus = String($(event.currentTarget).data("docstatus"));
			$rail
				.find("[data-docstatus]")
				.each((_i, button) =>
					$(button).attr("aria-pressed", String($(button).data("docstatus")) === filters.docstatus)
				);
			this.load();
		});
		$rail.find(".sb-search").on(
			"input",
			frappe.utils.debounce((event) => {
				filters.search = event.target.value.trim();
				this.load();
			}, 400)
		);
		$rail.find("[data-filter]").on("change", (event) => {
			filters[$(event.currentTarget).data("filter")] = event.target.value;
			this.load();
		});
	}

	async load(append) {
		const $list = this.$el.find(".sb-list");
		if (!append) {
			$list.html(this.placeholder("loading"));
		}
		const rows = await this.store.load_batches(append);
		this.render_list(rows);
	}

	render_list(rows) {
		const $list = this.$el.find(".sb-list");
		if (!rows.length) {
			$list.html(this.placeholder("no_batches"));
			return;
		}
		const items = rows
			.map(
				(row) => `
				<button type="button" class="sb-row" data-name="${sb_esc(row.name)}" aria-current="${
					row.name === this.store.current
				}">
					<span class="sb-row-main">
						<strong>${sb_esc(row.name)}</strong>
						<span class="text-muted">${sb_esc(sb_date(row.creation))} · ${sb_esc(
							sb_t("col_employees")
						)} ${row.employees}</span>
					</span>
					<span class="sb-row-side">
						<span class="sb-num">${sb_money(row.total_amount)}</span>
						${sb_chip(row.state)}
					</span>
				</button>`
			)
			.join("");
		$list.html(
			`<div class="sb-rows">${items}</div>${
				this.store.more
					? `<button type="button" class="btn btn-default btn-sm sb-more">${sb_esc(sb_t("load_more"))}</button>`
					: ""
			}`
		);
		$list.find(".sb-row").on("click", (event) => this.open($(event.currentTarget).data("name")));
		$list.find(".sb-more").on("click", () => this.load(true));
	}

	async open(name) {
		this.$el.find(".sb-row").each((_i, row) => $(row).attr("aria-current", $(row).data("name") === name));
		const $detail = this.$el.find(".sb-detail").addClass("sb-detail-open").html(this.placeholder("loading"));
		const batch = await this.store.load_batch(name);
		$detail.html(this.detail_html(batch));
		$detail.find("[data-action]").on("click", (event) => {
			const $button = $(event.currentTarget);
			this.app.actions.run($button.data("action"), batch.name, {
				employee: $button.data("employee"),
				type: $button.data("type"),
			});
		});
		$detail.find(".sb-close").on("click", () => $detail.removeClass("sb-detail-open"));
	}

	async reload(name) {
		await this.load();
		await this.open(name);
	}

	detail_html(batch) {
		const actions = batch.actions;
		const excluded = batch.groups.filter((group) => group.credit > 0 && (!group.biller || !group.service_codes));
		const bar = [
			sb_button("csv", sb_t("act_csv"), actions.csv, sb_t("reason_csv")),
			sb_button("payment_request", sb_t("act_pr"), actions.payment_request, sb_t("reason_pr")),
			sb_button("submit", sb_t("act_submit"), actions.submit, sb_t("reason_submit"), "btn-primary"),
			sb_button("journal_entry", sb_t("act_je"), actions.journal_entry, sb_t("reason_je")),
			sb_button("add_lines", sb_t("act_add_lines"), actions.edit, sb_t("reason_edit")),
			sb_button("cancel", sb_t("act_cancel"), actions.cancel, sb_t("reason_cancel"), "btn-danger"),
			sb_button("form", sb_t("act_form"), true, ""),
		].join("");
		return `
			<div class="sb-detail-head">
				<button type="button" class="btn btn-xs btn-default sb-close">×</button>
				<h4>${sb_esc(batch.name)} ${sb_chip(batch.state)}</h4>
				<div class="sb-facts">
					<span><span class="text-muted">${sb_esc(sb_t("col_created"))}:</span> ${sb_esc(sb_date(batch.creation))}</span>
					<span><span class="text-muted">${sb_esc(sb_t("debit"))}:</span> <span class="sb-num">${sb_money(batch.debit)}</span></span>
					<span><span class="text-muted">${sb_esc(sb_t("credit"))}:</span> <span class="sb-num">${sb_money(batch.credit)}</span></span>
					<span class="${batch.balanced ? "text-success" : "text-danger"}">${sb_esc(
						sb_t(batch.balanced ? "balanced" : "unbalanced")
					)}</span>
				</div>
				<div class="sb-facts">
					<span><span class="text-muted">${sb_esc(sb_t("linked_pr"))}:</span> ${sb_doc_links(SB_ROUTES.payment_request, batch.payment_requests)}</span>
					<span><span class="text-muted">${sb_esc(sb_t("linked_je"))}:</span> ${sb_doc_links(SB_ROUTES.journal_entry, batch.journal_entries)}</span>
				</div>
			</div>
			<div class="sb-actions">${bar}</div>
			${
				excluded.length
					? `<div class="sb-note">${sb_esc(
							sb_t("csv_excluded", excluded.map((group) => group.employee).join(", "))
					  )}</div>`
					: ""
			}
			<h5 class="sb-subhead">${sb_esc(sb_t("lines"))}</h5>
			${this.groups_html(batch)}
			${this.legacy_html(batch.legacy)}
		`;
	}

	groups_html(batch) {
		if (!batch.groups.length) {
			return this.placeholder("none");
		}
		const rows = batch.groups
			.map((group) => {
				const segments = group.segments
					.map(
						(segment) =>
							`<div class="sb-seg-line"><span class="sb-num">${sb_esc(segment.year)}</span>
							<span class="sb-num">${sb_money(segment.debit)}</span>
							<span class="${segment.account ? "text-muted" : "text-danger"}">${sb_esc(
								segment.account || sb_t("missing_account")
							)}</span></div>`
					)
					.join("");
				return `
					<tr>
						<td><strong>${sb_esc(group.employee)}</strong><div class="text-muted">${sb_esc(
							group.employee_name
						)}</div></td>
						<td>${sb_esc(group.types_arabic || group.type)}<div class="text-muted">${sb_esc(
							group.period
						)}</div></td>
						<td>${sb_esc(group.cost_center)}</td>
						<td>${segments}</td>
						<td class="sb-num">${sb_money(group.credit)}</td>
						<td>${
							batch.actions.edit
								? `<button type="button" class="btn btn-xs btn-default" data-action="remove"
									data-employee="${sb_esc(group.employee)}" data-type="${sb_esc(group.type)}">${sb_esc(
										sb_t("act_remove")
								  )}</button>`
								: ""
						}</td>
					</tr>`;
			})
			.join("");
		return `
			<div class="sb-table-wrap"><table class="table table-sm sb-table">
				<thead><tr>
					<th>${sb_esc(sb_t("employee"))}</th><th>${sb_esc(sb_t("fee_type"))}</th>
					<th>${sb_esc(sb_t("cost_center"))}</th><th>${sb_esc(sb_t("segments"))}</th>
					<th class="sb-num">${sb_esc(sb_t("credit"))}</th><th></th>
				</tr></thead>
				<tbody>${rows}</tbody>
			</table></div>`;
	}

	legacy_html(legacy) {
		if (!legacy || !legacy.length) {
			return "";
		}
		const rows = legacy
			.map(
				(row) => `<tr><td>${sb_esc(row.account)}</td><td>${sb_esc(row.cost_center)}</td>
				<td class="sb-num">${sb_money(row.debit_in_account_currency)}</td>
				<td class="sb-num">${sb_money(row.credit_in_account_currency)}</td></tr>`
			)
			.join("");
		return `
			<details class="sb-legacy"><summary>${sb_esc(sb_t("legacy_jv"))} (${legacy.length})</summary>
				<div class="sb-table-wrap"><table class="table table-sm sb-table">
					<thead><tr><th>${sb_esc(sb_t("account"))}</th><th>${sb_esc(sb_t("cost_center"))}</th>
					<th class="sb-num">${sb_esc(sb_t("debit"))}</th><th class="sb-num">${sb_esc(sb_t("credit"))}</th></tr></thead>
					<tbody>${rows}</tbody>
				</table></div>
			</details>`;
	}
}

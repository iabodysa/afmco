// Copyright (c) 2026, AFMCO and contributors

class SadadOverviewView {
	constructor(app) {
		this.app = app;
		this.store = app.store;
	}

	async render($container) {
		this.$el = $(`<div class="sb-overview"></div>`).appendTo($container);
		this.$el.html(`<div class="sb-empty text-muted">${sb_esc(sb_t("loading"))}</div>`);
		const data = await this.store.load_overview();
		const tile = (key, value) =>
			`<div class="sb-tile"><div class="sb-tile-label">${sb_esc(sb_t(key))}</div>
			<div class="sb-tile-value sb-num">${value === null ? sb_esc(sb_t("no_access")) : value}</div></div>`;
		const queue =
			data.queue === null
				? `<div class="sb-empty text-muted">${sb_esc(sb_t("no_access"))}</div>`
				: data.queue.length
				? `<div class="sb-rows">${data.queue
						.map(
							(row) => `<button type="button" class="sb-row" data-name="${sb_esc(row.name)}">
								<span class="sb-row-main"><strong>${sb_esc(row.name)}</strong>
								<span class="text-muted">${sb_esc(sb_date(row.creation))}</span></span>
								<span class="sb-row-side sb-num">${sb_money(row.total_amount)}</span>
							</button>`
						)
						.join("")}</div>`
				: `<div class="sb-empty text-muted">${sb_esc(sb_t("queue_empty"))}</div>`;
		this.$el.html(`
			<div class="sb-tiles">
				${tile("tile_drafts", data.open_drafts)}
				${tile("tile_pending", sb_money(data.pending_credit))}
				${tile("tile_no_je", data.submitted_without_je)}
				${tile("tile_paid", data.paid_this_month)}
			</div>
			<h5 class="sb-subhead">${sb_esc(sb_t("queue_title"))}</h5>
			${queue}
		`);
		this.$el.find(".sb-row").on("click", (event) => {
			this.store.current = $(event.currentTarget).data("name");
			this.app.show("batches");
		});
	}
}

// Copyright (c) 2026, AFMCO and contributors

const SB_MODULES = [
	"/assets/afmco/js/sadad_bulk/sb_i18n.js",
	"/assets/afmco/js/sadad_bulk/sb_config.js",
	"/assets/afmco/js/sadad_bulk/sb_utils.js",
	"/assets/afmco/js/sadad_bulk/sb_store.js",
	"/assets/afmco/js/sadad_bulk/sb_actions.js",
	"/assets/afmco/js/sadad_bulk/sb_batches.js",
	"/assets/afmco/js/sadad_bulk/sb_compose.js",
	"/assets/afmco/js/sadad_bulk/sb_overview.js",
];

frappe.pages["sadad-bulk"].on_page_load = function (wrapper) {
	frappe.require(SB_MODULES, () => {
		const page = frappe.ui.make_app_page({
			parent: wrapper,
			title: sb_t("page_title"),
			single_column: true,
		});
		const app = new SadadBulkApp(page);
		app.setup();
		wrapper.sadad_bulk = app;
	});
};

frappe.pages["sadad-bulk"].on_page_show = function (wrapper) {
	if (wrapper.sadad_bulk) {
		wrapper.sadad_bulk.refresh();
	}
};

class SadadBulkApp {
	constructor(page) {
		this.page = page;
		this.store = new SadadStore();
		this.actions = new SadadActions(this);
		this.views = {
			batches: new SadadBatchesView(this),
			compose: new SadadComposeView(this),
			overview: new SadadOverviewView(this),
		};
	}

	setup() {
		this.$root = $(`<div class="sb-root" dir="${SB_IS_RTL ? "rtl" : "ltr"}"></div>`).appendTo(
			this.page.main
		);
		this.$head = $(`<div class="sb-head"></div>`).appendTo(this.$root);
		this.$body = $(`<div class="sb-body"></div>`).appendTo(this.$root);
		this.page.set_primary_action(sb_t("new_batch"), () => this.compose(""), "add");
		this.render_head();
		this.show(this.store.view);
	}

	render_head() {
		const segments = SB_VIEWS.map(
			(view) =>
				`<button type="button" class="sb-seg-btn" data-view="${view}" aria-pressed="${
					view === this.store.view
				}">${sb_esc(sb_t(`view_${view}`))}</button>`
		).join("");
		this.$head.html(`<div class="sb-seg" role="group">${segments}</div>`);
		this.$head.find(".sb-seg-btn").on("click", (event) => this.show($(event.currentTarget).data("view")));
	}

	show(view) {
		this.store.view = view;
		this.$head
			.find(".sb-seg-btn")
			.each((_i, button) => $(button).attr("aria-pressed", $(button).data("view") === view));
		this.$body.empty();
		this.views[view].render(this.$body);
	}

	compose(batch) {
		this.store.reset_compose(batch);
		this.show("compose");
	}

	refresh() {
		if (this.$body) {
			this.show(this.store.view);
		}
	}
}

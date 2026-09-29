// Copyright (c) 2026, AFMCO and contributors

const IC_MODULES = [
	"/assets/afmco/js/iqama_control/ic_i18n.js",
	"/assets/afmco/js/iqama_control/ic_config.js",
	"/assets/afmco/js/iqama_control/ic_utils.js",
	"/assets/afmco/js/iqama_control/ic_store.js",
	"/assets/afmco/js/iqama_control/ic_actions.js",
	"/assets/afmco/js/iqama_control/ic_triage.js",
	"/assets/afmco/js/iqama_control/ic_dashboard.js",
	"/assets/afmco/js/iqama_control/ic_batch.js",
];

// R9-E H-08/H-12: every relocatable field _setup_filters() builds, named once
// so _place_filters() can slice a per-view subset out of the one shared form
// instead of every view showing every field. `employee` is deliberately
// listed here (the toggle loop still needs to find and hide it) but never
// appears in any view's own allowlist below — the on-list search band (G-09)
// is its one visible surface now, so it is folded out everywhere.
// R10-A: department and project were two separate entries here, one native
// Link and one derived Select, both racing to write the same filters.department
// key (ic_store.js _filters(), F-14). "project_filter" is the one cascade
// control that replaces both of them AND the cost-centre select that used to
// live only in the triage rail (ic_triage.js H-06, now removed) — one entry,
// one control, on every view that lists it below.
const IC_FILTER_FIELDS = [
	"corporation",
	"project_filter",
	"employee",
	"expiry_to",
	"only_with_sadad",
	"include_settled",
];

// B3: the same breakpoint the stylesheet's own layout rules break the rail
// and the triage grid at (iqama_control.css @media 1024/1023). Read here so
// the chrome and the layout never disagree about which side of it they stand.
const IC_NARROW_MAX = 1023;

frappe.pages["iqama-control"].on_page_load = function (wrapper) {
	// The page title is itself a translated string, so the language module has
	// to be in memory before the page is built, not after.
	frappe.require(IC_MODULES, () => {
		const page = frappe.ui.make_app_page({
			parent: wrapper,
			title: t("page_title_long"),
			single_column: true,
		});

		const board = new IqamaControl(page);
		board.setup();
	});
};

class IqamaControl {
	constructor(page) {
		this.page = page;
		this.rows = [];
		this.selected = new Set();
		this.history = {};
		// D-18: email -> User row, filled once per address and read by the
		// history renderer. A null entry is an address already asked for whose
		// lookup failed; it is never asked for a second time.
		this.users = {};
		this.nitaqat = {};
		// null until the count queries answer. Nothing renders a zero it did
		// not measure; a null prints an em dash.
		this.tally = null;
		this.expiry_counts = null;
		this.missing_count = null;
		this.duplicates = null;
		this.loading = false;
		// D-05: the list draws one page and grows on an explicit press.
		this.shown = IC_PAGE_ROWS;
		this.view = IC_VIEWS[0].key;
		// The scope each view opens on, and the operator's last answer in it.
		// All three open on the same window: the scope is an age window now, so
		// it narrows no status and no owner, and the reason batch and the
		// dashboard had to open wider than triage is gone — a step card and a
		// tile count inside their own view's population either way.
		this.scope_of = IC_VIEWS.reduce((memory, view) => {
			memory[view.key] = IC_SCOPE_DEFAULT;
			return memory;
		}, {});
		this.step = IC_STEPS[0].key;
		this.risk = "";
		// D-17: the "Missing fees" filter, shared by all three views.
		this.missing_fees = false;
		// LAYOUT-01: history folds by default and remembers whether the operator
		// opened it, so paging through records does not re-fold it every time.
		this.history_open = false;
		this.focus = null;
		this._gen = 0;
		this._statgen = 0;
		this._histgen = 0;
		this._bandgen = 0;
		this._creating = false;
		this.can_write = frappe.model.can_write(IC_DOCTYPE);
		this.can_create_pr = frappe.model.can_create(IC_EXPENSE_DOCTYPE);
		this.lens = this.can_create_pr ? "accounts" : "operations";
	}

	setup() {
		// The design carries no framework page title bar: its own header band is
		// the only chrome above the body, so the native head is stood down and
		// the whole surface is built inside page.main.
		this.page.wrapper.addClass("ic-page");
		this.page.wrapper.attr("dir", IC_DIR).attr("lang", IC_IS_RTL ? "ar" : IC_LANG);
		document.documentElement.classList.toggle("ic-rtl", IC_IS_RTL);

		this.$head = $('<header class="ic-head"></header>').appendTo(this.page.main);
		this.$view = $('<div class="ic-view"></div>').appendTo(this.page.main);
		this._watch_narrow();

		this._setup_header();
		this._setup_filters();
		this._setup_actions();
		this._setup_keys();
		this.refresh();
	}

	// B3: .ic-narrow's rules (iqama_control.css) compact the chrome for a
	// container too narrow to hold the wide layout — this.$view's own inline
	// size, not the window's, since the page can sit inside a narrower host
	// than the viewport. One observer, opened once here; every later resize
	// toggles the same class rather than a second watcher racing it.
	_watch_narrow() {
		const apply = () => this.$view.toggleClass("ic-narrow", this.$view.width() <= IC_NARROW_MAX);
		if (window.ResizeObserver) {
			new ResizeObserver(apply).observe(this.$view.get(0));
		} else if (window.matchMedia) {
			window.matchMedia(`(max-width: ${IC_NARROW_MAX}px)`).addEventListener("change", apply);
		}
		apply();
	}

	_setup_header() {
		$('<span class="ic-head-brand"></span>')
			.text(t("page_title"))
			.appendTo(this.$head);

		// Two equal flex-grow spacers, one either side of the switcher. This is
		// what centres it between the brand and the right-hand block; a margin
		// auto would centre it on the page axis instead, which the design does
		// not do.
		$('<span class="ic-head-gap"></span>').appendTo(this.$head);

		this.$seg = $('<div class="ic-seg" role="tablist"></div>').appendTo(this.$head);

		IC_VIEWS.forEach((view) => {
			$('<button class="ic-seg-btn" type="button" role="tab"></button>')
				.attr("data-view", view.key)
				.text(ic_label(view.label))
				.on("click", () => this._switch(view.key))
				.appendTo(this.$seg);
		});

		$('<span class="ic-head-gap"></span>').appendTo(this.$head);

		this.$count = $('<span class="ic-head-count ic-num"></span>').appendTo(this.$head);

		// The design sketches a search field and an avatar here, but that is
		// the desk navbar drawn into the artboard: the real navbar already
		// carries both, one row above. Repeating them would be two search
		// boxes and two user icons on one screen, so only the menu is built.
		this.menu = this._dropdown({
			wrap_class: "ic-head-menu",
			button_class: "ic-head-more",
			list_class: "ic-head-menu-list",
			item_class: "ic-head-menu-item",
			label: "\u22ef",
			aria_label: t("actions"),
		});
		this.menu.$el.appendTo(this.$head);

		// The names the stylesheet and the rest of the page already use.
		this.$menu = this.menu.$el;
		this.$avatar = this.menu.$button;
		this.$menu_list = this.menu.$list;
	}

	// One dropdown mechanism for the whole page: the header menu and the action
	// bar's More are the same object wearing different class names. Every
	// instance registers in one list, so a single document listener closes all
	// of them and no second listener is bound per render.
	_dropdown(options) {
		if (!this._menus) {
			this._menus = [];
			$(document).on("click.ic_menu", () => this._close_menus(null));
			$(document).on("keydown.ic_menu", (event) => {
				if (event.key === "Escape") this._close_menus(null);
			});
		}

		const $wrap = $("<div></div>").addClass(options.wrap_class);
		const $button = $('<button type="button"></button>')
			.addClass(options.button_class)
			.attr("aria-haspopup", "true")
			.attr("aria-expanded", "false")
			.text(options.label)
			.appendTo($wrap);
		if (options.aria_label) $button.attr("aria-label", options.aria_label);

		const $list = $("<ul hidden></ul>").addClass(options.list_class).appendTo($wrap);

		const menu = {
			$el: $wrap,
			$button: $button,
			$list: $list,
			open: (on) => {
				$list.prop("hidden", !on);
				$button.attr("aria-expanded", on ? "true" : "false");
			},
			add: (entry) => {
				const $item = $('<button type="button"></button>')
					.addClass(options.item_class)
					.addClass(entry.extra_class || "")
					.text(entry.label);
				if (entry.disabled) {
					$item.prop("disabled", true);
					if (entry.reason) $item.attr("title", entry.reason);
				} else {
					$item.on("click", () => {
						menu.open(false);
						entry.action();
					});
				}
				$("<li></li>").append($item).appendTo($list);
				return $item;
			},
		};

		$button.on("click", (event) => {
			event.stopPropagation();
			const wanted = $list.prop("hidden");
			this._close_menus(menu);
			menu.open(wanted);
		});

		this._menus.push(menu);
		return menu;
	}

	// A menu built inside a re-rendered view dies with its node. The registry
	// drops those entries here rather than growing by one on every render.
	_close_menus(keep) {
		this._menus = (this._menus || []).filter((menu) => {
			const node = menu.$el.get(0);
			if (!node || !document.documentElement.contains(node)) return false;
			if (menu !== keep) menu.open(false);
			return true;
		});
	}

	// The status filter is one piece of state with two faces: the rail rows at
	// full width, this select below the rail's breakpoint and on the dashboard,
	// which carries no rail. Only one of the two is ever on screen.
	_status_select(extra_class) {
		// F-13: the select had no visible label of its own, only an aria-label
		// no sighted operator ever reads. extra_class moves to this wrapper so
		// every rule that showed or hid the bare select (page/iqama_control/
		// iqama_control.css:3042, :4820) now shows or hides the label with it.
		const $field = $('<div class="ic-status-field"></div>').addClass(extra_class || "");
		$('<span class="control-label"></span>').text(t("status_filter")).appendTo($field);

		const $select = $('<select class="ic-status-select"></select>')
			.attr("aria-label", t("status_filter"))
			.appendTo($field);

		// The same status set the rail lists — the ones this scope can hold. An
		// option outside it would return an empty list under a number the rail
		// never showed.
		$("<option></option>").attr("value", "").text(t("all_statuses")).appendTo($select);
		this._status_range().forEach((status) =>
			$("<option></option>").attr("value", status).text(ic_label(status)).appendTo($select)
		);

		$select.val(this.status.val() || "");
		$select.on("change", () => {
			this.status.val($select.val());
			this.focus = null;
			this.refresh();
		});
		return $field;
	}

	// One selection Set serves the whole page, so a view change must not drop
	// what the operator already picked: Triage and Batch act on the same records.
	//
	// A view is ALWAYS painted from an answer fetched for it. Painting the rows
	// already in memory is what left a view standing on the previous view's
	// answer — the two views hold their own scope, and every other filter on the
	// page moves under them both, so "the base did not change" is a claim the
	// switch cannot make. refresh() keeps the current view on screen while the
	// answer is in flight and render() runs once, when it lands.
	_switch(key) {
		if (this.view === key) return;
		this.view = key;
		this._paint_tabs();

		const wanted = this.scope_of[key];
		if (wanted !== undefined) this.scope.val(wanted);
		// K-01: this.status is page-wide, and on batch the stage bar (built in
		// ic_batch.js) is the only status control an operator can see — a stale
		// pick left standing here would narrow the stage-card counts against a
		// status nothing on batch names, so a card could read a count and open
		// an empty picker under it. ic_batch.js/ic_store.js: this is the one
		// clearing point, keyed on the property name `this.status`.
		if (key === "batch") this.status.val("");
		this.refresh();
	}

	// Which tab reads as the open one. The switch paints it at the press so the
	// header answers immediately, and render() paints it again when the view it
	// belongs to is built.
	_paint_tabs() {
		this.$seg.find(".ic-seg-btn").each((index, node) => {
			const $button = $(node);
			const on = $button.attr("data-view") === this.view;
			$button.toggleClass("is-on", on).attr("aria-selected", on ? "true" : "false");
		});
	}

	// The header count and the rail's "All statuses" row are one number: the
	// population every filter on the page has left standing.
	_headline() {
		return t("open_count", ic_count_or_wait(this._population()));
	}

	// A FULL build of the current view. It runs when the view changes, when the
	// first answer lands, and nowhere else — every other state change repaints
	// the region it actually moved. owner note.6.
	render() {
		this._paint_tabs();
		this.$count.text(this._headline());
		this._park();
		this._close_menus(null);
		// K-05: a drawer left standing across a view switch would confirm an
		// action against rows that are no longer on screen. It closes here,
		// before the empty, so its return-focus target still exists.
		this._close_drawer();
		this.$view.removeClass("is-loading").empty();

		if (this.view === "dashboard") this._paint_region(this.$view, () => this._render_dashboard());
		else if (this.view === "batch") this._paint_region(this.$view, () => this._render_batch());
		else this._paint_region(this.$view, () => this._render_triage());

		this._built = this.view;
		this._place_filters();
		this.$view.find(IC_AUTO_DIR).attr("dir", "auto");
	}

	// R19-HOST: one thrown paint used to abort everything after it in the
	// same call chain — the filter placement below, a sibling region's own
	// build, an unreached detail empty-state. This is the one boundary every
	// paint call in this file and in the view modules (ic_triage.js) runs
	// through, so a single region's failure stays that region's failure
	// instead of taking the host, the placer and the action bar down with it.
	// The error still reaches the console; nothing here silences it.
	_paint_region($region, build) {
		try {
			build($region);
		} catch (error) {
			console.error("iqama_control: a view region failed to paint", error);
		}
	}

	// Repaint ONE region without taking the rest of the view down with it.
	//
	// Emptying a container runs jQuery's cleanData over its whole subtree
	// (jquery 3.7.0 dist/jquery.js:6119 for empty, :6160 for html), which
	// strips the handlers off every node inside it. this.$filterbar, this.$form
	// and this.$actions are built once and reused across renders, so any region
	// that happens to hold one of them detaches it before the clear and the
	// builder puts it back — detach() keeps the handlers, empty() does not.
	_repaint($region, build) {
		if (!$region || !$region.length) return;

		const host = $region.get(0);
		[this.$filterbar, this.$form, this.$actions].forEach(($node) => {
			if ($node && $node.length && host.contains($node.get(0))) $node.detach();
		});

		this._close_menus(null);
		$region.empty();
		this._paint_region($region, build);

		this._place_filters();
		$region.find(IC_AUTO_DIR).attr("dir", "auto");
	}

	// Everything on screen that is DATA rather than chrome. A view that has not
	// been built yet is built; one that has only has its numbers and its rows
	// replaced, so the filter bar, the action bar and the operator's scroll
	// position all survive.
	_repaint_data() {
		if (this._built !== this.view) {
			this.render();
			return;
		}

		this.$count.text(this._headline());
		this.$view.toggleClass("is-loading", Boolean(this.loading));

		if (this.view === "dashboard") this._repaint_dashboard();
		else if (this.view === "batch") this._repaint_batch();
		else this._repaint_triage();
	}

	// The framework renders every add_field control into page_form, which sits
	// in the native head. The design has no filter strip there, so the form is
	// relocated into whichever surface the current view owns: the triage rail,
	// or the card strip in batch. Relocating rather than rebuilding keeps
	// this.scope, this.status and the rest as live controls for the modules
	// that read them.
	// Emptying a container runs jQuery's cleanData over its whole subtree
	// (jquery 3.7.0 dist/jquery.js:6119 for empty, :6160 for html), which strips
	// the handlers off every node inside it. The filter bar, the relocated
	// framework form and the action bar are all reused across renders and all
	// live inside this.$view, so each was losing its click handlers on the first
	// re-render and every control on them went dead. detach() keeps the handlers;
	// the view that wants a node appends it back.
	_park() {
		if (this.$filterbar) this.$filterbar.detach();
		if (this.$form) this.$form.detach();
		if (this.$actions) this.$actions.detach();
	}

	// A view that declares no [data-ic-filters] host gets no filter surface.
	// The header is not a fallback: dropping the bar there floated it over the
	// sticky header and left a control from the previous view on screen.
	//
	// R9-E H-08/H-12/D-fix: corporation/department/project/employee/expiry_to/
	// only_with_sadad/include_settled are one shared page_form,
	// built once in _setup_filters() and relocated wholesale by this method —
	// so a control meant for one view used to ride along into every view that
	// declares a filter host. This resolves a per-view allowlist and hides
	// the field's own wrapper for the fields NOT on it, rather than deleting
	// or rebuilding the control: get_value()/set_value() keep answering for
	// whatever other code still reads that field (ic_triage.js's on-list
	// search band writes this.employee even though no view shows it in the
	// folded form any more), and the next call of this method against a
	// different view resets the same wrappers against THAT view's own
	// allowlist, so nothing leaks across views and nothing needs a manual
	// reset on view switch.
	_filter_field_wrapper(fieldname) {
		const control = this[fieldname];
		if (!control) return null;
		// page.add_field() controls answer $wrapper directly. page.add_select()
		// (this.lens_field) answers the bare <select> pulled out of that same
		// wrapper — frappe/public/js/frappe/ui/page.js add_select() returns
		// `field.$wrapper.find("select")...`, so add_select and add_field share
		// one wrapper shape (a `.form-group.col-md-2`) and `.closest(".form-group")`
		// reaches the identical node either way.
		if (control.$wrapper) return control.$wrapper;
		if (control.closest) return control.closest(".form-group");
		return null;
	}

	// One allowlist per view, read by fieldname against IC_FILTER_FIELDS.
	// Dashboard's list is never consulted in practice — it declares no
	// [data-ic-filters] host at all (H-10 ground truth: no filters on that
	// screen) — but it is named here so every view is accounted for once,
	// in one place, rather than left implicit.
	_view_filter_allowlist() {
		return {
			triage: [
				"corporation",
				"project_filter",
				"expiry_to",
				"only_with_sadad",
				"include_settled",
			],
			// R10-A: batch had department+project (no cost centre) before this
			// round. It gets the SAME cascade as triage, cost-centre path
			// included — one control everywhere it appears beats a batch
			// screen stuck one step behind triage's own filter.
			batch: ["project_filter", "include_settled"],
			dashboard: [],
		};
	}

	_place_filters() {
		if (!this.$form) return;

		// B2: a view can declare a side-rail dock (data-ic-slot="rail") and an
		// inline one (data-ic-slot="bar") at once — Triage does, for the two
		// widths it stands at. The rail wins whenever the current view
		// declares one; a view with only the inline dock falls back to it, and
		// a view that declares neither (Dashboard, H-10) gets no host at all.
		const $rail = this.$view.find('[data-ic-filters][data-ic-slot="rail"]').first();
		const $bar = this.$view.find('[data-ic-filters][data-ic-slot="bar"]').first();
		let $host = $rail.length ? $rail : $bar;

		const allowed = this._view_filter_allowlist()[this.view] || [];

		// R19-HOST: a view whose allowlist is non-empty MEANS to carry filters
		// (H-10 is the one intentional exception, allowlist [], and never
		// reaches here). If its declared host did not reach the DOM this
		// cycle — a paint that threw before appending it, not a missing
		// declaration — this view still gets a place to stand: a bare
		// [data-ic-filters] host dropped straight into the view root carries
		// the same base rule every declared host already carries
		// (iqama_control.css: ".ic-view [data-ic-filters]"). A page with no
		// filters at all is worse than one with them in the plain spot.
		if (!$host.length && allowed.length) {
			$host = $('<div data-ic-filters data-ic-slot="fallback"></div>').appendTo(this.$view);
		}
		if (!$host.length) return;
		// R12-E owner order: the panel PRESENTS a reduced set. this._visible_filters
		// (named once, top of _setup_filters()) is the single switch; every field
		// not on it keeps building, keeps its state key and its _filters(except)
		// contribution, and just renders hidden — reverting is editing that one list.
		const visible = this._visible_filters || IC_FILTER_FIELDS;
		IC_FILTER_FIELDS.forEach((fieldname) => {
			const $wrapper = this._filter_field_wrapper(fieldname);
			if ($wrapper && $wrapper.length) {
				$wrapper.toggleClass("ic-field-hidden", !allowed.includes(fieldname) || !visible.includes(fieldname));
			}
		});
		this.lens_field.$el.toggle(this.view === "triage");

		this.$filterbar.appendTo($host);
		this.$form.appendTo($host);
	}

	// The status filter is one piece of state that several controls move: the
	// rail rows at full width, one select below the rail's breakpoint. It answers
	// val() so the query builder reads it the way it read a select.
	_held(initial) {
		let value = initial;
		return {
			val: (next) => {
				if (next === undefined) return value;
				value = next;
				return value;
			},
		};
	}

	// A choice the operator makes by pressing one of a few buttons. It answers
	// val() so the query builder keeps reading it the way it read a select.
	_choice(options, initial, on_change) {
		const state = { value: initial };
		const $group = $('<div class="ic-choice" role="group"></div>');

		const paint = () => {
			$group.find(".ic-choice-btn").each((index, node) => {
				const $button = $(node);
				$button.toggleClass("is-on", $button.attr("data-value") === state.value);
			});
		};

		options.forEach((option) => {
			$('<button class="ic-choice-btn" type="button"></button>')
				.attr("data-value", option.value)
				.text(option.label)
				.on("click", () => {
					state.value = option.value;
					paint();
					on_change();
				})
				.appendTo($group);
		});

		paint();
		return { $el: $group, val: (next) => {
			if (next === undefined) return state.value;
			state.value = next;
			paint();
			return next;
		} };
	}

	_setup_filters() {
		// R12-E owner order: filter panel reduced to status + department,
		// presentation only. "project_filter" is the department/cost-centre
		// cascade (R10-A merged them into one control, so department cannot
		// render standalone); "include_settled" is an operator surface that
		// must never be hidden. corporation/employee/expiry_to/only_with_sadad
		// keep building below, keep their state key and their _filters(except)
		// contribution, and simply render hidden via _place_filters(). Edit
		// this one line to change what the panel shows.
		this._visible_filters = ["project_filter", "include_settled"];

		const reload = frappe.utils.debounce(() => this.refresh(), 350);

		this.$filterbar = $('<div class="ic-filterbar"></div>');

		// The scope asks ONE question: how far back. The options and the range
		// each one resolves to are declared together in IC_SCOPES, so a button
		// cannot name a window the query does not apply.
		this.scope = this._choice(
			IC_SCOPES.map((scope) => ({ label: t(scope.label_key), value: scope.key })),
			this.scope_of[this.view],
			() => {
				this.scope_of[this.view] = this.scope.val();
				reload();
			}
		);
		this.scope.$el.addClass("ic-choice--wrap").appendTo(this.$filterbar);

		// One status filter on the page. The fourteen-button group that used to
		// sit here was a third copy of the rail rows and of the batch stepper,
		// and it was the element that overflowed the bar into the header.
		this.status = this._held("");

		this.corporation = this.page.add_field({
			fieldname: "corporation",
			label: t("f_corporation"),
			fieldtype: "Link",
			options: "Corporation",
			change: reload,
		});

		// R10-A: the project filter, as one cascade — press it, choose a path
		// (department or cost centre), pick the value that path lists, and the
		// list narrows to the employees under it. Replaces the old raw
		// department Link and the derived project Select (F-14) that used to
		// race each other for the same filters.department key, and the
		// separate cost-centre select ic_triage.js used to paint into the
		// rail (H-06) — one control, appended into the same shared page_form
		// every other filter field lives in, so _place_filters() docks and
		// hides it exactly the way it does a native field.
		this._paint_project_cascade();

		this.employee = this.page.add_field({
			fieldname: "employee",
			label: t("f_employee"),
			fieldtype: "Data",
			change: reload,
		});

		this.expiry_to = this.page.add_field({
			fieldname: "expiry_to",
			label: t("f_expiry_to"),
			fieldtype: "Date",
			change: reload,
		});

		// The lens decides which fields the detail column's grid carries. It
		// moves that grid and nothing else, so it repaints the record on screen
		// rather than the page around it.
		this.lens_field = this._choice(
			Object.keys(IC_LENSES).map((key) => ({ label: ic_label(IC_LENSES[key].label), value: key })),
			this.lens,
			() => {
				this.lens = this.lens_field.val();
				if (this.view === "triage") this._repaint_focus();
				else this._repaint_data();
			}
		);
		this.lens_field.$el.appendTo(this.$filterbar);

		this.only_with_sadad = this.page.add_field({
			fieldname: "only_with_sadad",
			label: t("f_with_sadad"),
			fieldtype: "Check",
			change: reload,
		});

		// "Include settled" asks a second question about the status dimension,
		// and the version that wrote filters.status behind the rail's back is
		// what made the rail count a population the list did not hold. It is
		// answered in _status_range instead, which is the one place the rail,
		// the tally and the list all read their statuses from.
		this.include_settled = this.page.add_field({
			fieldname: "include_settled",
			label: t("f_include_settled"),
			fieldtype: "Check",
			// Unticking it takes the settled statuses out of the range. A pick
			// the range no longer holds is dropped here, at the one control that
			// can shrink the range, rather than left to resolve to an empty set.
			change: () => {
				const status = this.status.val();
				if (status && !this._status_range().includes(status)) this.status.val("");
				reload();
			},
		});

		// Everything past the two button groups is a narrower question the
		// operator asks now and then. It stays folded so the surface reads as
		// two rows of buttons rather than nine controls.
		this.$form = this.page.page_form.addClass("ic-filters").prop("hidden", true);

		$('<button class="ic-choice-btn ic-more" type="button"></button>')
			.text(t("more_filters"))
			.attr("aria-expanded", "false")
			.on("click", (event) => {
				const $button = $(event.currentTarget);
				const open = this.$form.prop("hidden");
				this.$form.prop("hidden", !open);
				$button.toggleClass("is-on", open);
				$button.attr("aria-expanded", open ? "true" : "false");
			})
			.appendTo(this.$filterbar);
	}

	// R10-A — THE PROJECT FILTER CASCADE
	//
	// One control, three states, read off this.project_cascade = { open,
	// mode, value }, the SAME object ic_store.js's _filters() reads to write
	// filters.department / filters.cost_center (never both — the two modes
	// are alternate paths, not stacked levels). Built once here, into the
	// shared page_form; _place_filters() docks and hides it like a native
	// field because this.project_filter carries a $wrapper the same way a
	// real Frappe field control does.
	//
	//   closed   the trigger pill alone, its own label naming the path, the
	//            value and the count so the operator reads their filter
	//            without opening anything.
	//   step 1   panel open, no mode yet: two buttons, "Department" /
	//            "Cost center" (t("f_department") / t("f_cost_center") — no
	//            new label needed for this step).
	//   step 2   mode chosen: a Back crumb (t("back")) plus the values that
	//            EXIST in the current records for that mode, each with its
	//            own count, sourced from this.project_counts /
	//            this.cost_center_counts — the same tallies
	//            _count_by_project()/_count_by_cost_center() (ic_store.js)
	//            already compute from the one _filters() builder.
	//   step 3   a value picked: the panel closes, the pill's label becomes
	//            the summary, and refresh() is called directly — a real
	//            fetch, not a repaint, matching the pattern _rail_row()
	//            already uses for its own click-to-filter rows.
	//
	// Clear-filter is its own button inside the panel, enabled whenever a
	// mode or a value is set. It resets mode/value/open and calls refresh();
	// it never touches this.include_settled — that is a different question,
	// answered in ic_store.js's _status_range(), which this control never
	// reads or writes.
	_paint_project_cascade() {
		this.project_cascade = this.project_cascade || { open: false, mode: "", value: "" };

		const $wrapper = $('<div class="form-group ic-project-cascade" data-ic-cascade></div>');
		const $trigger = $('<button type="button" class="ic-choice-btn ic-project-cascade-trigger"></button>')
			.attr("aria-expanded", "false")
			.on("click", () => {
				this.project_cascade.open = !this.project_cascade.open;
				this._repaint_project_cascade();
			})
			.appendTo($wrapper);
		const $panel = $('<div class="ic-project-cascade-panel"></div>').prop("hidden", true).appendTo($wrapper);

		this.project_filter = { $wrapper: $wrapper, $trigger: $trigger, $panel: $panel };
		// K-04: owner order 4 wants the project dimension below the time-period
		// buttons, not folded behind "More filters" (this.$form/page.page_form).
		// This overrides R10-A's own recorded choice to host it in page_form
		// (DESIGN/PHASE-R10-A-RESULT.md:5). Placed directly after this.scope.$el
		// so it is the second control on the always-visible bar, in place of the
		// old fold. _filter_field_wrapper() still resolves this.project_filter
		// by reference, so per-view hiding (_view_filter_allowlist) is
		// untouched, and _park()/_repaint() already detach this.$filterbar as
		// one unit before any empty(), so the cascade keeps its own handlers
		// across a re-render exactly as it did living inside this.$form.
		$wrapper.insertAfter(this.scope.$el);

		this._repaint_project_cascade();
		return $wrapper;
	}

	// Rebuilds only the cascade's own DOM. Called on open/close, on every
	// mode/value/back/clear action, and once a fetch's counts land
	// (ic_store.js refresh().then()) — never rebuilds $rail/$list/$detail,
	// so it is a local repaint exactly like owner note.6 asks every OTHER
	// control-level change on this page to be.
	_repaint_project_cascade() {
		const filter = this.project_filter;
		if (!filter) return;
		const cascade = this.project_cascade;

		filter.$trigger.attr("aria-expanded", cascade.open ? "true" : "false");
		filter.$trigger.toggleClass("is-on", !!(cascade.mode && cascade.value));
		filter.$trigger.empty();
		$('<span class="ic-project-cascade-trigger-label"></span>')
			.text(this._project_cascade_summary())
			.appendTo(filter.$trigger);

		filter.$panel.empty().prop("hidden", !cascade.open);
		if (!cascade.open) return;

		if (!cascade.mode) {
			this._paint_cascade_modes(filter.$panel);
		} else {
			this._paint_cascade_crumbs(filter.$panel);
			this._paint_cascade_values(filter.$panel);
		}

		$('<button type="button" class="ic-choice-btn ic-project-cascade-clear"></button>')
			.prop("disabled", !cascade.mode && !cascade.value)
			.text(t("clear_project"))
			.on("click", () => this._project_cascade_clear())
			.appendTo(filter.$panel);
	}

	// The one line the pill shows closed: which path, which value, how many
	// records. cascade.value is already an ic_project_label() output — it is
	// the KEY of this.project_map / this.cost_center_map, both built in
	// ic_store.js by labelling every row BEFORE it is used as a map key — so
	// this never re-derives or re-reads a raw multi-segment string.
	_project_cascade_summary() {
		const cascade = this.project_cascade;
		if (!cascade.mode) return t("f_dept_cost_center");
		const mode = IC_PROJECT_MODES.find((entry) => entry.key === cascade.mode);
		const mode_label = mode ? t(mode.label_key) : cascade.mode;
		if (!cascade.value) return mode_label;
		const counts = cascade.mode === "department" ? this.project_counts : this.cost_center_counts;
		const count = counts ? counts[cascade.value] : undefined;
		const counted = count === undefined ? cascade.value : `${cascade.value} (${ic_count_or_wait(count)})`;
		return `${mode_label} · ${counted}`;
	}

	// Step 1: exactly the two paths IC_PROJECT_MODES declares. No value list
	// yet, so picking a mode here writes NOTHING to _filters() — the value
	// list itself (step 2) is what narrows the query, which is why this step
	// is a repaint, never a fetch.
	_paint_cascade_modes($panel) {
		const $modes = $('<div class="ic-project-cascade-modes"></div>').appendTo($panel);
		IC_PROJECT_MODES.forEach((entry) => {
			$('<button type="button" class="ic-choice-btn"></button>')
				.text(t(entry.label_key))
				.on("click", () => {
					this.project_cascade.mode = entry.key;
					this.project_cascade.value = "";
					this._repaint_project_cascade();
				})
				.appendTo($modes);
		});
	}

	// The way back from step 2/3 to step 1, always visible once a mode is
	// chosen, and the one place the operator reads which path they are on
	// while the value list is open.
	_paint_cascade_crumbs($panel) {
		const cascade = this.project_cascade;
		const mode = IC_PROJECT_MODES.find((entry) => entry.key === cascade.mode);
		const $crumbs = $('<div class="ic-project-cascade-crumbs"></div>').appendTo($panel);
		$('<button type="button" class="ic-project-cascade-back"></button>')
			.text(t("back"))
			.on("click", () => {
				// K-04: a mode alone writes nothing into ic_store.js's _filters()
				// (only cascade.value feeds filters.department/cost_center), so
				// clearing a mode-only pick is a plain repaint. Clearing an
				// APPLIED value already narrowed the last fetch — leaving Back
				// as a repaint would show an unfiltered pill while the list,
				// rail and tally stayed narrowed, so this refetches instead.
				const had_value = !!this.project_cascade.value;
				this.project_cascade.mode = "";
				this.project_cascade.value = "";
				if (had_value) {
					this.focus = null;
					this.refresh();
				} else {
					this._repaint_project_cascade();
				}
			})
			.appendTo($crumbs);
		$('<span class="ic-project-cascade-path"></span>')
			.text(mode ? t(mode.label_key) : cascade.mode)
			.appendTo($crumbs);
	}

	// Step 2: EXACTLY the values present in the current records for the
	// chosen mode — this.project_options / this.cost_center_options are
	// built in ic_store.js by grouping the real query, not by listing every
	// value the system knows, and each option carries the count that same
	// query answered. Step 3: picking one writes cascade.value, closes the
	// panel, and calls refresh() directly (a real fetch), the same pattern
	// _rail_row()'s click handler already uses.
	_paint_cascade_values($panel) {
		const cascade = this.project_cascade;
		const options = cascade.mode === "department" ? this.project_options || [] : this.cost_center_options || [];
		const counts = cascade.mode === "department" ? this.project_counts : this.cost_center_counts;

		const $values = $('<div class="ic-project-cascade-values"></div>').appendTo($panel);
		options.forEach((label) => {
			const count = counts ? counts[label] : undefined;
			$('<button type="button" class="ic-project-cascade-value"></button>')
				.toggleClass("is-on", cascade.value === label)
				.text(count === undefined ? label : `${label} (${ic_count_or_wait(count)})`)
				.on("click", () => {
					this.project_cascade.value = label;
					this.project_cascade.open = false;
					this.focus = null;
					this.refresh();
				})
				.appendTo($values);
		});
	}

	// The clear-filter button owner note.* asks for by name: one action back
	// to the unfiltered state. Resets mode/value/open only — include_settled
	// is a different control answering a different question (ic_store.js
	// _status_range()) and this never touches it.
	_project_cascade_clear() {
		this.project_cascade.mode = "";
		this.project_cascade.value = "";
		this.project_cascade.open = false;
		this.focus = null;
		this.refresh();
	}

	// The design puts no action in the header: every button sits at the foot of
	// the column or card it acts on. The framework's primary action and inner
	// button group would render into the native head, so the bar is built here
	// and the views append it to their own footer.
	_setup_actions() {
		this.$actions = $('<div class="ic-actionbar"></div>');

		// Refresh is a page action, not a record action. It sat on this bar and
		// pushed the record's own transitions off the edge of the detail column,
		// so it lives in the header menu with the other page-level entries.

		// No payment button here. The design carries exactly one payment
		// affordance, in the triage detail column, and the triage view renders
		// it against the focused row so it can disable itself with a reason.
		// Building it here as well would put the same action on the bar twice.

		// D-26: the "J / K next" hint is gone from the viewport. It was 9px of
		// unexplained Vim idiom in a corner, and the two arrow buttons in the
		// detail nav bar are the visible control it was standing in for. The
		// full list answers from the header menu and from the framework's own
		// "?" dialog, which reads the shortcuts registered against this page.
		$('<span class="ic-actionbar-gap"></span>').appendTo(this.$actions);

		[
			{ label: t("refresh"), action: () => this.refresh() },
			{
				label: t("shortcuts"),
				action: () => frappe.ui.keys.show_keyboard_shortcut_dialog(),
			},
			{ label: t("copy_selected"), action: () => this._copy_selected() },
			{ label: t("copy_recent"), action: () => this._copy_recent() },
			{
				label: t("select_all_loaded"),
				action: () => {
					this.rows.forEach((row) => this.selected.add(row.name));
					this._repaint_selection();
				},
			},
			{
				label: t("bulk_clear"),
				action: () => {
					this.selected.clear();
					this._anchor = null;
					this._repaint_selection();
				},
			},
		].forEach((entry) => this.menu.add(entry));
	}

	// D-26: J and K are a Vim idiom nobody in operations was taught. The arrow
	// keys do the same thing, and every binding carries a description so the
	// framework's "?" dialog lists it (apps/frappe/frappe/public/js/frappe/ui/
	// keyboard.js, show_keyboard_shortcut_dialog reads standard_shortcuts).
	_setup_keys() {
		[
			{ shortcut: "down", description: t("next_record"), action: () => this._step_focus(1) },
			{ shortcut: "up", description: t("prev_record"), action: () => this._step_focus(-1) },
			{ shortcut: "j", description: t("next_record"), action: () => this._step_focus(1) },
			{ shortcut: "k", description: t("prev_record"), action: () => this._step_focus(-1) },
			{
				shortcut: "x",
				description: t("key_select"),
				action: () => {
					if (this.focus) this._toggle(this.focus);
				},
			},
		].forEach((entry) =>
			frappe.ui.keys.add_shortcut(Object.assign({ page: this.page }, entry))
		);
	}
}

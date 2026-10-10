// Copyright (c) 2026, AFMCO and contributors

// View 1 — Triage. Three columns, no gap: a 210 saved-view rail on a sunk
// ground, a 340 record list, and a detail column that takes the rest and ends
// in the page's one action bar.
//
// The design draws every row as a wireframe placeholder bar. This view carries
// real data, so each bar is read as a step on the type ramp instead: a 9px bar
// is the primary line, a 7px bar the secondary one, an 11px bar a field value.

Object.assign(IqamaControl.prototype, {
	// The view is built once into three regions. Every later state change
	// repaints the region it moved and leaves the other two standing, which is
	// what owner note.6 asks for: a press changes the data, not the page.
	_render_triage() {
		const $wrap = $('<div class="ic-tri-wrap"></div>').appendTo(this.$view);
		const $grid = $('<div class="ic-triage"></div>').appendTo($wrap);
		this.$rail = $('<nav class="ic-rail"></nav>').appendTo($grid);
		this.$list = $('<div class="ic-list"></div>').appendTo($grid);
		this.$detail = $('<section class="ic-detail"></section>').appendTo($grid);

		// R19-HOST: three independent regions, so one thrown paint must not
		// cost the other two — _paint_region (iqama_control.js) is the same
		// boundary _repaint() already gives every later pass.
		this._paint_region(this.$rail, ($el) => this._paint_triage_rail($el));
		this._paint_region(this.$list, ($el) => this._paint_list($el));
		this._paint_region(this.$detail, ($el) => this._paint_detail($el));
	},

	_repaint_triage() {
		this._repaint(this.$rail, ($el) => this._paint_triage_rail($el));
		this._repaint(this.$list, ($el) => this._paint_list($el));
		this._repaint(this.$detail, ($el) => this._paint_detail($el));
	},

	// LAYOUT R4: the rail's filter dock is a Triage-only detail — Dashboard
	// and Batch already own their own [data-ic-filters] host, and a second
	// host in their rail would race _place_filters() for the relocated
	// framework form. _paint_rail() itself stays the one builder every view
	// calls; only this wrapper adds the dock, and only Triage calls it.
	_paint_triage_rail($rail) {
		this._paint_rail($rail);
		// The design gives view 1 no filter strip: the rail replaces it. The
		// page shell moves the relocated framework form — which now carries
		// the unified project-filter cascade (R10-A, iqama_control.js) in
		// place of the old separate department/project/cost-centre controls —
		// into the first [data-ic-filters] it finds, so the host sits under
		// the saved-view list.
		$('<div class="ic-rail-filters" data-ic-filters data-ic-slot="rail"></div>').appendTo($rail);
	},

	// The same 1024 the stylesheet breaks at. Read rather than assumed, because
	// the overlay and the auto-focus have to agree about which side they are on.
	_is_wide() {
		if (!window.matchMedia) return true;
		return window.matchMedia("(min-width: 1024px)").matches;
	},

	// LAYOUT R4: the ONE rail builder every view calls, so the saved-view
	// list cannot drift between Triage, Dashboard and Batch again.
	_paint_rail($rail) {
		// Below the rail's breakpoint the rows have nowhere to stand, so they
		// collapse into this one select. Both write this.status, so the page
		// never carries two status filters at one width.
		this._status_select("ic-rail-select").appendTo($rail);

		const $saved = $('<div class="ic-rail-list"></div>').appendTo($rail);
		const counts = this._status_counts();
		const held = this.status.val();

		// D-09: the rows and the total come from one tally over one filter
		// base, and the rows listed are exactly the statuses this scope holds,
		// so they sum to the row above them.
		this._rail_row($saved, "", t("all_statuses"), this._population(), !held);
		// F-11: every status the scope holds gets a row, whether or not the
		// current filters leave it counting zero. Dropping a zero-count row
		// here rebuilt the rail's option set from the loaded result instead of
		// the range, and it took the only way back to that status with it.
		this._status_range().forEach((status) => {
			const count = counts[status];
			this._rail_row($saved, status, ic_label(status), count, held === status);
		});

		return $rail;
	},

	_rail_row($saved, status, label, count, on) {
		const $row = $('<button class="ic-rail-row" type="button"></button>')
			.toggleClass("is-on", on)
			.on("click", () => {
				this.status.val(status);
				this.focus = null;
				this.refresh();
			})
			.appendTo($saved);

		// A11Y-02: the dot is one of four tones, and each tone wears its own
		// SHAPE as well as its own fill, so the rail still separates in a
		// greyscale screenshot. The label beside it is the third channel.
		$('<span class="ic-rail-dot"></span>')
			.addClass(status ? `ic-dot--${ic_status_tone(status)}` : "ic-dot--all")
			.appendTo($row);
		$('<span class="ic-rail-label"></span>').text(label).appendTo($row);
		$('<span class="ic-rail-count ic-num"></span>').text(ic_count_or_wait(count)).appendTo($row);
		return $row;
	},

	_paint_list($list) {
		const rows = this._sorted_rows(this._visible_rows());
		const page = this._page_rows(rows);

		// ITEM 1: one extra request for every employee id on THIS page of rows,
		// never one request per row against a 500-row fetch — see
		// _load_employee_photos() in ic_store.js.
		this._load_employee_photos(page);

		// D-04: below 1024px the detail column is a full-screen overlay, so
		// focusing the first row on arrival would cover the list the operator
		// came to read. At that width a record is opened only by asking for it.
		if (!this.focus && rows.length && this._is_wide()) this.focus = rows[0].name;

		// The order a shift-click and the detail arrows read. A range means
		// "everything between the last row I touched and this one" over the
		// whole list, not over the page that happens to be drawn.
		this._order = rows.map((row) => row.name);

		// G-09: this.employee (iqama_control.js:475) was already a live filter —
		// ic_store.js:82-83 already wrote it into every query — but its only
		// control was a small field buried in the page header, which is why the
		// owner read the screen as carrying no search at all. This band gives it
		// a primary, on-screen control instead of a second filter path: it reads
		// and writes the SAME this.employee field, so it refetches through the
		// SAME one query builder every other filter on the page uses, and the
		// header count and the rows stay one count.
		const $search = $('<div class="ic-list-search"></div>').appendTo($list);
		// K-03: a visible label plus a leading glyph, so the control reads as a
		// search field on screen and not just to a screen reader. No icon font
		// exists on this page — every other glyph here (the ‹ › arrows, the
		// history arrow) is a bare Unicode character, so this one is too.
		$('<span class="control-label"></span>').text(t("search_employee_number")).appendTo($search);
		$('<span class="ic-list-search-glyph" aria-hidden="true">⌕</span>').appendTo($search);
		const $search_input = $('<input type="search" class="ic-list-search-input">')
			.attr("placeholder", t("search_employee_number"))
			.attr("aria-label", t("search_employee_number"))
			.val(this.employee.get_value() || "")
			.appendTo($search);
		// K-03/K-20: the clear control is the one thing on screen that says a
		// number was typed. It only ever drops the employee filter — restoring
		// the nine filters _widen_for_search reset is the SEPARATE control
		// below, because clearing the search and undoing the widening are two
		// different questions an operator can ask.
		const $search_clear = $('<button type="button" class="ic-list-search-clear"></button>')
			.attr("aria-label", t("clear_search"))
			.text("×")
			.on("click", () => {
				$search_input.val("");
				update_search_clear();
				this.employee.set_value("");
			})
			.appendTo($search);
		const update_search_clear = () => $search_clear.toggle(Boolean($search_input.val()));
		update_search_clear();
		$search_input.on("input", update_search_clear);
		const commit_search = () => {
			const value = $search_input.val().trim();
			if (value === (this.employee.get_value() || "")) return;
			// D-XX/Item 4: a value typed here has to find its record regardless
			// of every other filter narrowing the page right now — see
			// _widen_for_search() in ic_store.js.
			if (value) this._widen_for_search();
			this.employee.set_value(value);
		};
		$search_input.on("keydown", (event) => {
			if (event.key !== "Enter") return;
			event.preventDefault();
			commit_search();
		});
		$search_input.on("blur", commit_search);

		// K-20: ic_store.js snapshots the widened filters onto
		// this._search_snapshot and names which of them actually moved onto
		// this._search_widened. This is the only place that state is ever
		// announced, and restore is the only way back short of re-setting all
		// nine by hand.
		if (this._search_widened && this._search_widened.length) {
			const $status = $('<div class="ic-list-search-status text-muted"></div>').appendTo($list);
			$('<span class="ic-list-search-status-text"></span>')
				.text(t("search_widened_filters", ic_count(this._search_widened.length)))
				.appendTo($status);
			$('<button type="button" class="ic-btn ic-list-search-restore"></button>')
				.text(t("restore_filters"))
				.on("click", () => {
					if (this._restore_filters()) this.refresh();
				})
				.appendTo($status);
		}

		// The 52px band the design fills with one search rect. The header already
		// owns search, so the band carries the live risk filter instead, and the
		// rect's fill and radius are what the band's control wears.
		const $head = $('<div class="ic-list-head"></div>').appendTo($list);
		this._render_select_all($head, page);
		$('<span class="ic-list-title"></span>').text(t("records")).appendTo($head);
		this._render_sort($head);
		if ((this.sort_by || "expiry") === "expiry") {
			this._render_bands($head);
		} else {
			this._render_departments($head);
		}
		// D-09: the number heading the list is the population the list is drawn
		// from, not the length of the page inside it. What is on screen is said
		// under the rows instead.
		$('<span class="ic-list-count ic-num"></span>')
			.text(ic_count_or_wait(this._list_total()))
			.appendTo($head);
		// D-16: the badge at the end of every row is a bare number. This is
		// where its unit is written, once, instead of on 500 rows.
		if ((this.sort_by || "expiry") === "expiry") {
			$('<span class="ic-list-days"></span>').text(t("days_col")).appendTo($head);
		}

		if (!rows.length) {
			this._empty_state($list, t("list_empty"));
		} else {
			const $body = $('<div class="ic-list-body"></div>').appendTo($list);
			page.forEach((row) => this._list_row(row).appendTo($body));
			this._render_more($list, rows, $body);
		}

		// A filter can hide a selected row, so the bar is rendered off the
		// selection Set rather than off what is on screen.
		this._render_bulk_bar($list);
	},

	// F-14: the sort is a client-side ordering over the loaded page — project
	// has no DB column to order a query by. Two buttons, same ic-choice the
	// scope group already wears, so this needs no CSS of its own.
	_render_sort($head) {
		const $group = $('<div class="ic-choice" role="group"></div>').appendTo($head);
		[
			{ key: "expiry", label: t("sort_expiry") },
			{ key: "project", label: t("sort_project") },
		].forEach((option) => {
			$('<button class="ic-choice-btn" type="button"></button>')
				.toggleClass("is-on", (this.sort_by || "expiry") === option.key)
				.text(option.label)
				.on("click", () => {
					this.sort_by = option.key;
					this._repaint(this.$list, ($el) => this._paint_list($el));
				})
				.appendTo($group);
		});
		return $group;
	},

	// D-27: an empty state that only says "nothing here" is a dead end. It
	// names the narrowing that produced it and carries the way out of it.
	_empty_state($parent, message) {
		const $box = $('<div class="ic-empty text-muted"></div>').appendTo($parent);
		$('<span class="ic-empty-text"></span>').text(message).appendTo($box);

		const escapes = [];
		if (this.risk) escapes.push({ label: t("clear_risk"), action: () => (this.risk = "") });
		if (this.missing_fees) {
			escapes.push({ label: t("clear_fees"), action: () => (this.missing_fees = false) });
		}
		if (this.status.val()) {
			escapes.push({ label: t("show_all_statuses"), action: () => this.status.val("") });
		}
		// The escape is the operator's answer for this view, so it is recorded
		// where the control records its own: a switch away and back reads
		// scope_of, and an answer kept only on the button would be dropped.
		if (this.scope.val() !== "all") {
			escapes.push({
				label: t("show_all_records"),
				action: () => {
					this.scope.val("all");
					this.scope_of[this.view] = "all";
				},
			});
		}
		// K-20: a mistyped search leaves every guard above false — before this
		// the only escape drawn was a dead Refresh under a message blaming
		// filters the widen had already reset. Guarded on an active search so
		// it never outranks a real narrowing already offered above it.
		if (this.employee.get_value()) {
			escapes.push({ label: t("clear_search"), action: () => this.employee.set_value("") });
		}
		// Nothing is narrowed and the answer is still empty. That is a real
		// empty, and the only thing left to offer is asking again — but it is
		// offered, because an empty state with no way forward is the dead end
		// the rule is about.
		escapes.push({ label: t("refresh"), action: () => {} });

		const escape = escapes[0];
		$('<button class="ic-empty-link" type="button"></button>')
			.text(escape.label)
			.on("click", () => {
				escape.action();
				this.focus = null;
				this.refresh();
			})
			.appendTo($box);
		return $box;
	},

	// D-05: the list draws IC_PAGE_ROWS at a time and grows by an explicit
	// press. The press APPENDS the next page onto the rows already standing and
	// repaints the foot alone — it never rebuilds the list, so the scroll
	// position, the selection boxes and every bound handler survive it.
	_render_more($list, rows, $body) {
		const $foot = $('<div class="ic-list-foot text-muted"></div>').appendTo($list);
		this._paint_foot($foot, rows, $body);
		return $foot;
	},

	_paint_foot($foot, rows, $body) {
		const drawn = this._page_rows(rows).length;

		$('<span class="ic-list-shown ic-num"></span>')
			.text(t("showing_of", ic_count(drawn), ic_count_or_wait(this._list_total())))
			.appendTo($foot);

		if (drawn < rows.length) {
			$('<button class="ic-btn ic-list-more" type="button"></button>')
				.text(t("load_more", ic_count(Math.min(IC_PAGE_ROWS, rows.length - drawn))))
				.on("click", () => {
					const from = this.shown || IC_PAGE_ROWS;
					this.shown = from + IC_PAGE_ROWS;
					rows.slice(from, this.shown).forEach((row) =>
						this._list_row(row).appendTo($body)
					);
					$foot.empty();
					this._paint_foot($foot, rows, $body);
					$body.find(IC_AUTO_DIR).attr("dir", "auto");
				})
				.appendTo($foot);
			return $foot;
		}

		// D-13: the 500 is a fetch cap, never a distribution. It is named as
		// what it is, and only when it is actually holding records back.
		if (this.rows.length >= IC_ROW_LIMIT) {
			$('<span class="ic-truncated"></span>').text(t("narrow_filters")).appendTo($foot);
		}
		return $foot;
	},

	// The head box answers for the rows on screen: checked when every one of
	// them is selected, indeterminate when only some are. indeterminate has no
	// HTML attribute, so it is written onto the node after the box is built.
	_render_select_all($head, rows) {
		const pickable = rows.filter((row) => this._is_pickable(row));
		const picked = pickable.filter((row) => this.selected.has(row.name)).length;
		const all = pickable.length > 0 && picked === pickable.length;

		// Item 5: _repaint_selection() (below) keeps this SAME box and its ONE
		// change handler alive across a click — the triage view repaints
		// selection in place and never calls _render_select_all() again for it
		// — so a handler that closed over `all` from THIS render kept answering
		// the first click's question forever, and unticking never reached
		// this.selected. The box's own `checked` property is the live signal
		// instead: the browser already flips it before `change` fires, so it
		// reads the click that just happened, not the state this box was
		// built with.
		this.$all_box = $('<input type="checkbox" class="ic-list-all">')
			.attr("aria-label", t("select_all"))
			.prop("disabled", !pickable.length)
			.prop("checked", all)
			.on("change", (event) => {
				const checked = Boolean(event.target.checked);
				pickable.forEach((row) => {
					if (checked) this.selected.add(row.name);
					else this.selected.delete(row.name);
				});
				this._anchor = null;
				this._repaint_selection();
			})
			.appendTo($head);

		this.$all_box.get(0).indeterminate = picked > 0 && !all;
		return this.$all_box;
	},

	// The bar the operator only sees while something is selected. It offers the
	// transitions every selected row can take, which ic_legal_actions() computes
	// as the intersection over the selected statuses — the same one function the
	// detail bar and the Batch step read. The destructive transition answers from
	// the More menu here for the same reason it does on the detail bar: it must
	// not be the button under a fast hand.
	_render_bulk_bar($list) {
		const picked = this._selected_rows();
		if (!picked.length) return null;

		const $bar = $('<div class="ic-bulk"></div>').appendTo($list);
		$('<span class="ic-bulk-count ic-num"></span>')
			.text(t("bulk_selected", ic_count(picked.length)))
			.appendTo($bar);

		const actions = ic_legal_actions(picked, this.can_write);
		const primary = this._pick_primary(actions);

		if (primary) {
			$('<button class="ic-btn ic-btn--primary" type="button"></button>')
				.text(ic_label(primary.label))
				.on("click", () => this._run_action(primary, picked))
				.appendTo($bar);
		}

		const folded = actions.filter((action) => action !== primary);
		// Item 1 (round 8c): the ORIGINAL is bulk-first -- select many records,
		// pick one payment type, get ONE Payment Requisition covering all of
		// them (_create_pr() in ic_actions.js already sums the amount and
		// builds one remark block per employee; that half was already correct,
		// only this reachability wiring was missing). Same _payment_entries()
		// builder _detail_entries() uses below, driven off the whole selection
		// instead of one row.
		//
		// R17-A: the owner's ruling on a mixed selection — the action appears
		// when SOME picked rows are IC_PAYABLE_STATUS and then acts on that
		// subset only, and contributes nothing when none qualify. DATA-READINESS
		// disabling (ic_skip_reason, ic_actions.js) still runs inside
		// _payment_entries on that subset, so a status-qualified row missing a
		// SADAD number still surfaces disabled with its reason. The label grows
		// the same "(N)" the batch bar already uses (ic_batch.js count_suffix)
		// whenever the subset is narrower than the full pick, so the operator
		// can see the action will not touch every selected row.
		const payable = picked.filter((row) => row.status === IC_PAYABLE_STATUS);
		const payment_entries = payable.length
			? this._payment_entries(payable, (type) => this._create_pr(type, payable)).map((entry) =>
					payable.length < picked.length
						? Object.assign({}, entry, { label: t("count_suffix", entry.label, ic_count(payable.length)) })
						: entry
			  )
			: [];

		if (folded.length || payment_entries.length) {
			const menu = this._dropdown({
				wrap_class: "ic-bulk-menu",
				button_class: "ic-btn ic-more-actions",
				list_class: "ic-head-menu-list ic-drop-list",
				item_class: "ic-head-menu-item",
				label: t("more_actions"),
			});
			folded.forEach((action) =>
				menu.add({
					label: ic_label(action.label),
					disabled: action.disabled,
					reason: action.reason,
					action: () => this._run_action(action, picked),
				})
			);
			payment_entries.forEach((entry) => menu.add(entry));
			menu.$el.appendTo($bar);
		}

		$('<button class="ic-btn ic-bulk-clear" type="button"></button>')
			.text(t("bulk_clear"))
			.on("click", () => {
				this.selected.clear();
				this._anchor = null;
				this._repaint_selection();
			})
			.appendTo($bar);

		return $bar;
	},

	// D-13: every chip here is a real count over the same filter base the list
	// is drawn from, not a pass over the loaded page. Pressing one narrows that
	// base on the server, so the number on the chip is the number of rows the
	// press returns.
	_render_bands($head) {
		const $bands = $('<div class="ic-bands"></div>').appendTo($head);

		// The four bands the chips offer, plus — when the operator arrived by
		// pressing a bar on the overdue chart — the narrower band that press
		// applied, so the filter now in force is always the one on screen and
		// is always clearable from here.
		const held = this.risk ? ic_band(this.risk) : null;
		const bands = IC_RISK.slice();
		if (held && !bands.includes(held)) bands.push(held);

		bands.forEach((band) => {
			const count = this._expiry_count(band.key);
			if (count === 0 && this.risk !== band.key) return;
			$('<button class="ic-chip" type="button"></button>')
				.addClass(`ic-chip--${band.key}`)
				.toggleClass("is-held", this.risk === band.key)
				.attr("aria-pressed", this.risk === band.key ? "true" : "false")
				.on("click", () => {
					this.risk = this.risk === band.key ? "" : band.key;
					this.focus = null;
					this.refresh();
				})
				.append($('<span class="ic-chip-label"></span>').text(ic_label(band.label)))
				.append($('<span class="ic-chip-count ic-num"></span>').text(ic_count_or_wait(count)))
				.appendTo($bands);
		});

		// F-20: the undated bucket has no day bounds, so it is not one of
		// IC_RISK and ic_band() cannot resolve it back from this.risk. It
		// gets its own chip, wired to the same expiry_counts.none the
		// overdue chart's bar already reads and the same risk="none" filter
		// _filters() in ic_store.js already narrows on.
		const none_count = this._expiry_count("none");
		if (none_count !== 0 || this.risk === "none") {
			$('<button class="ic-chip" type="button"></button>')
				.addClass("ic-chip--none")
				.toggleClass("is-held", this.risk === "none")
				.attr("aria-pressed", this.risk === "none" ? "true" : "false")
				.on("click", () => {
					this.risk = this.risk === "none" ? "" : "none";
					this.focus = null;
					this.refresh();
				})
				.append($('<span class="ic-chip-label"></span>').text(t("no_expiry")))
				.append($('<span class="ic-chip-count ic-num"></span>').text(ic_count_or_wait(none_count)))
				.appendTo($bands);
		}

		this._missing_fees_chip($bands);
	},
	_render_departments($head) {
		const $bands = $('<div class="ic-bands"></div>').appendTo($head);
		const cascade = this.project_cascade || { mode: "", value: "" };
		(this.project_options || []).forEach((label) => {
			const count = this.project_counts ? this.project_counts[label] : undefined;
			const held = cascade.mode === "department" && cascade.value === label;
			$('<button class="ic-chip" type="button"></button>')
				.toggleClass("is-held", held)
				.attr("aria-pressed", held ? "true" : "false")
				.on("click", () => {
					const target = this.project_cascade || (this.project_cascade = { open: false, mode: "", value: "" });
					const was_held = target.mode === "department" && target.value === label;
					target.mode = was_held ? "" : "department";
					target.value = was_held ? "" : label;
					target.open = false;
					if (this._repaint_project_cascade) this._repaint_project_cascade();
					this.focus = null;
					this.refresh();
				})
				.append($('<span class="ic-chip-label"></span>').text(label))
				.append($('<span class="ic-chip-count ic-num"></span>').text(ic_count_or_wait(count)))
				.appendTo($bands);
		});
		return $bands;
	},

	// D-17: the records whose fees were never calculated used to be invisible —
	// their 0.00 read as a real amount and they were counted into the payment
	// batch. They get their own filter rather than being dropped, because
	// somebody has to go and calculate them.
	_missing_fees_chip($bands) {
		const count = this.missing_count;
		if (count === 0 && !this.missing_fees) return null;

		return $('<button class="ic-chip ic-chip--missing" type="button"></button>')
			.toggleClass("is-held", Boolean(this.missing_fees))
			.attr("aria-pressed", this.missing_fees ? "true" : "false")
			.on("click", () => {
				this.missing_fees = !this.missing_fees;
				this.focus = null;
				this.refresh();
			})
			.append($('<span class="ic-chip-label"></span>').text(t("missing_fees")))
			.append($('<span class="ic-chip-count ic-num"></span>').text(ic_count_or_wait(count)))
			.appendTo($bands);
	},

	// A 50px row: the 6x30 status bar, the selection box, the two-line text
	// stack the wireframe draws as a 9px and a 7px bar, then the days pill.
	_list_row(row) {
		// Item 2: a settled record (Renewed, Rejected) reads as its status,
		// never as overdue — ic_expiry_state()/ic_urgency() are not consulted
		// once a record is closed, so a new expiry that has since passed
		// cannot repaint it critical.
		const settled = this._is_settled(row);
		const state = settled ? ic_settled_expiry_state(row) : ic_expiry_state(row);
		const urgency = settled ? "none" : ic_urgency(ic_days_left(row));

		const $row = $('<div class="ic-row" role="button" tabindex="0"></div>')
			.addClass(`ic-row--${urgency}`)
			.toggleClass("is-focus", this.focus === row.name)
			.toggleClass("is-selected", this.selected.has(row.name))
			.attr("data-name", row.name);

		$('<span class="ic-row-bar"></span>').appendTo($row);

		// Shift is read off the click: a change event carries no modifier key,
		// so a range select has to be decided before the box flips.
		if (settled) {
			$('<span class="ic-row-nopick" aria-hidden="true"></span>').appendTo($row);
		} else {
			$('<input type="checkbox" class="ic-row-check">')
				.prop("checked", this.selected.has(row.name))
				.attr("aria-label", t("select"))
				.on("click", (event) => {
					event.stopPropagation();
					this._pick(row.name, event.shiftKey);
				})
				.appendTo($row);
		}

		const $who = $('<span class="ic-row-who"></span>').appendTo($row);

		// H-03: the row is exactly two lines — the employee number as the
		// large title, the employee name as the small subtitle. Nothing else
		// rides these two lines: the copy control (H-02) now lives only in the
		// detail panel's identity block, and the file number/company that used
		// to sit under the name moved there too, each as its own labeled field
		// (H-04). G-05/G-06 still holds why the employee number stands where an
		// iqama number would — the DocType carries no separate field.
		$('<span class="ic-row-employee ic-num ic-latn"></span>').text(row.employee || "").appendTo($who);
		// DATA-01: "MD - - SABUJ" is an import placeholder, not a name.
		$('<span class="ic-row-name"></span>').text(ic_row_name(row)).appendTo($who);

		// DATA-01: two open records for one employee. The operator acting on
		// one of them cannot otherwise see that the other exists. Carried as a
		// row modifier class and a title, not a third line of text, so H-03's
		// two-line rule still holds. iqama_control.css needs a visual marker for
		// .ic-row.is-duplicate — see PHASE-R9-A-RESULT.md DROPPED.
		const duplicate = this._is_duplicate(row);
		$row.toggleClass("is-duplicate", duplicate);
		if (duplicate) $row.attr("title", t("duplicate_hint"));

		// D-16: text and title come out of the same call, so the badge can no
		// longer say -1420 while its tooltip says 1420 with no sign and the
		// detail panel calls it "Days left".
		$('<span class="ic-row-days ic-num"></span>')
			.addClass(`ic-days--${urgency}`)
			.attr("title", state.long)
			.text(state.short)
			.appendTo($row);

		$row.on("click", (event) => {
			if ($(event.target).closest("a, button, input, label").length) return;
			this._focus_row(row.name);
		});
		$row.on("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			this._focus_row(row.name);
		});
		return $row;
	},

	// owner note.6: focusing a record replaces the detail column and re-marks
	// two rows. Nothing else on the page is rebuilt, so the rail, the list, the
	// filter bar and the scroll position all stay where they were.
	_focus_row(name) {
		this.focus = name;
		if (this.view !== "triage") {
			this.view = "triage";
			this.render();
			return;
		}
		this._repaint_focus();
		const node = this.$list.find(`.ic-row[data-name="${name}"]`).get(0);
		if (node && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
	},

	_repaint_focus() {
		if (this._built !== this.view || this.view !== "triage" || !this.$list) {
			this.render();
			return;
		}
		this.$list.find(".ic-row").each((index, node) => {
			const $row = $(node);
			$row.toggleClass("is-focus", $row.attr("data-name") === this.focus);
		});
		this._repaint(this.$detail, ($el) => this._paint_detail($el));
	},

	// owner note.6: ticking a box moves the boxes, the head box and the bulk
	// bar. It does not move the list, the rail or the record on screen.
	_repaint_selection() {
		if (this._built !== this.view) {
			this.render();
			return;
		}
		if (this.view === "batch") {
			this._repaint_batch_selection();
			return;
		}
		if (this.view !== "triage" || !this.$list || !this.$list.length) {
			this._repaint_data();
			return;
		}

		this.$list.find(".ic-row").each((index, node) => {
			const $row = $(node);
			const on = this.selected.has($row.attr("data-name"));
			$row.toggleClass("is-selected", on);
			$row.find(".ic-row-check").prop("checked", on);
		});

		if (this.$all_box && this.$all_box.length) {
			const page = this._page_rows(this._sorted_rows(this._visible_rows()));
			const picked = page.filter((row) => this.selected.has(row.name)).length;
			const all = page.length > 0 && picked === page.length;
			this.$all_box.prop("checked", all);
			this.$all_box.get(0).indeterminate = picked > 0 && !all;
		}

		this.$list.find(".ic-bulk").remove();
		this._close_menus(null);
		this._render_bulk_bar(this.$list);
	},

	_step_focus(offset) {
		if (this.view !== "triage") return;
		const rows = this._sorted_rows(this._visible_rows());
		if (!rows.length) return;
		const at = rows.findIndex((row) => row.name === this.focus);
		const next = Math.min(Math.max((at < 0 ? 0 : at) + offset, 0), rows.length - 1);

		// Stepping past the drawn page grows it rather than stopping at its
		// edge, so the arrows walk the whole list D-26 says they walk.
		if (next >= (this.shown || IC_PAGE_ROWS)) {
			this.shown = next + 1;
			this._repaint(this.$list, ($el) => this._paint_list($el));
		}
		this._focus_row(rows[next].name);
	},

	// LAYOUT-01: the column reads in the order the decision is made, not in the
	// order the DocType stores its fields. The first four bands never scroll — a
	// blocking reason and the amount due are the two things the operator opened
	// this record for, and both used to sit under a 240px history list.
	//
	//  1 nav       back, record N of M, previous / next
	//  2 identity  the employee name, largest, with the status beside it
	//  3 decision  what is blocking the record, and what its expiry date means
	//  4 money     the amount due, and the SADAD number with a copy button
	//  5 fields    the lens grid                                   ) one scroller
	//  6 history   folded, its summary carrying count and last date )
	//  7 actions   the sticky bar
	_paint_detail($detail) {
		const row = this._row(this.focus);
		$detail.toggleClass("ic-detail--empty", !row);

		if (!row) {
			$('<div class="ic-empty text-muted"></div>').text(t("detail_empty")).appendTo($detail);
			$('<div class="ic-detail-rule"></div>').appendTo($detail);
			this._render_actionbar($detail, null);
			return;
		}

		const $fixed = $('<div class="ic-detail-fixed"></div>').appendTo($detail);
		this._detail_nav($fixed);
		this._detail_identity($fixed, row);
		this._detail_decision($fixed, row);
		this._detail_money($fixed, row);

		const $scroll = $('<div class="ic-detail-scroll"></div>').appendTo($detail);

		const $fields = $('<div class="ic-detail-fields"></div>').appendTo($scroll);
		this._render_fields($fields, row, IC_LENSES[this.lens].fields);

		// The design has no band for the flags. They take their own row right
		// after the field grid rather than opening a band the design does not
		// carry, and stay a sibling of the grid instead of a row inside it —
		// a field and a flag for the same value never share one container.
		const $flags = this._row_flags(row);
		if ($flags) $flags.appendTo($scroll);

		this._render_history($scroll, row);

		$('<div class="ic-detail-rule"></div>').appendTo($detail);
		this._render_actionbar($detail, row);
	},

	// Band 1. Below the rail's breakpoint this column is a full-screen overlay,
	// so Back is the only way out of it; above that width the css hides Back and
	// the two arrows are all that remains.
	_detail_nav($fixed) {
		const order = this._order || [];
		const at = order.indexOf(this.focus);
		// F-21: order is the loaded page, capped at IC_ROW_LIMIT rows, so its
		// length is a page size and not the filtered total. this._list_total()
		// is the same server tally the list header already heads itself with.
		const total = this._list_total();
		// The step buttons can only ever walk the loaded page \u2014 that is not a
		// server-cursor question, it is what "loaded" means \u2014 so when Next
		// stops at the cap rather than at the true end of the filtered set,
		// the tooltip says so instead of reading like the last record.
		const at_cap = order.length >= IC_ROW_LIMIT && at >= order.length - 1;
		const $nav = $('<div class="ic-detail-nav"></div>').appendTo($fixed);

		$('<button class="ic-detail-back" type="button"></button>')
			.text(t("back"))
			.on("click", () => {
				this.focus = null;
				this._repaint_focus();
			})
			.appendTo($nav);

		$('<span class="ic-detail-pos ic-num"></span>')
			.text(t("record_n_of_m", ic_count(at + 1), ic_count_or_wait(total)))
			.appendTo($nav);

		$('<span class="ic-detail-nav-gap"></span>').appendTo($nav);

		$('<button class="ic-detail-step" type="button"></button>')
			.attr("aria-label", t("prev_record"))
			.attr("title", t("prev_record"))
			.prop("disabled", at <= 0)
			.text("\u2039")
			.on("click", () => this._step_focus(-1))
			.appendTo($nav);

		$('<button class="ic-detail-step" type="button"></button>')
			.attr("aria-label", t("next_record"))
			.attr("title", at_cap ? t("showing_of", ic_count(order.length), ic_count_or_wait(total)) : t("next_record"))
			.prop("disabled", at < 0 || at >= order.length - 1)
			.text("\u203a")
			.on("click", () => this._step_focus(1))
			.appendTo($nav);

		return $nav;
	},

	// Band 2. The employee name is the largest thing in the column. The DocType
	// carries no iqama number field — its own field list holds employee, file_no
	// and cost_center and nothing else that identifies a person on the phone — so
	// those three stand where the brief asks for an iqama number.
	_detail_identity($fixed, row) {
		const $band = $('<header class="ic-detail-title"></header>').appendTo($fixed);
		const $head = $('<div class="ic-detail-head"></div>').appendTo($band);
		// H-01: a portrait beside the identity values, not a hero image above
		// them \u2014 $head holds the avatar and $identity as siblings, side by
		// side. The frame's own pixel size is a CSS token this JS does not
		// own; see PHASE-R9-A-RESULT.md DROPPED for the iqama_control.css
		// change the sizing still needs.
		this._avatar(row, "avatar-large").appendTo($head);

		const $identity = $('<div class="ic-detail-identity"></div>').appendTo($head);
		$('<div class="ic-detail-name"></div>')
			.append(
				$("<a></a>")
					.attr("href", frappe.utils.get_form_link("Iqama Renewal Tracking", row.name))
					.text(ic_row_name(row))
			)
			.appendTo($identity);

		// H-04 (blocker): every identity value is its own labeled element on
		// its own line \u2014 the joined middot run this replaces used to print the
		// employee number, file number, cost centre and company as one prose
		// sentence. H-02: the copy control that used to sit on every list row
		// now lives here, once, on the employee number field it names.
		const $grid = $('<div class="ic-detail-id-grid"></div>').appendTo($identity);
		if (row.employee) {
			const $emp = this._field($grid, t("f_employee"), row.employee, "ic-field--num");
			$('<button class="ic-btn ic-copy" type="button"></button>')
				.text(t("copy"))
				.attr("aria-label", `${t("copy")} \u2014 ${t("f_employee")}`)
				.on("click", () => this._copy_text(row.employee))
				.appendTo($emp.find(".ic-field-value"));
		}
		const file_label = ic_file_no_label(row.file_no);
		if (file_label) this._field($grid, ic_label(IC_FIELD_LABELS.file_no), file_label, "ic-field--num");
		// H-06: the same department/cost-centre dimension the filter narrows
		// on, read through the one label function, ic_project_label().
		const cost_center_label = ic_project_label(row.cost_center || "");
		if (cost_center_label) this._field($grid, ic_label(IC_FIELD_LABELS.cost_center), cost_center_label);
		const org = row.company_name || row.corporation || "";
		if (org) this._field($grid, t("f_corporation"), org);

		const $chips = $('<div class="ic-detail-chips"></div>').appendTo($band);

		// A11Y-02: the pill wears one of the four tones and its own status text,
		// so colour is never the only thing carrying the state.
		$('<span class="indicator-pill"></span>')
			.addClass(`ic-pill--${ic_status_tone(row.status)}`)
			.text(ic_label(row.status || ""))
			.appendTo($chips);

		const nitaqat = this.nitaqat[row.corporation];
		if (nitaqat) {
			$('<span class="ic-chip ic-chip--static"></span>')
				.addClass(`ic-band--${ic_band_key(nitaqat)}`)
				.append($('<span class="ic-chip-label"></span>').text(t("nitaqat")))
				.append($('<span class="ic-chip-count"></span>').text(String(nitaqat)))
				.appendTo($chips);
		}

		return $band;
	},

	// Band 3. Whatever stands between this record and its renewal, and what its
	// expiry date means. D-16: the wording and the sign are the same
	// ic_expiry_state() the list badge and its tooltip read.
	_detail_decision($fixed, row) {
		const $band = $('<div class="ic-decision"></div>').appendTo($fixed);

		const reason = row.reason_of_preventing_renewal || row.reason_of_not_renew || "";
		if (this._is_blocked(row) || reason) {
			const $block = $('<div class="ic-decision-block ic-tone--critical"></div>').appendTo($band);
			$('<span class="ic-decision-label"></span>').text(t("block_reason")).appendTo($block);
			$('<span class="ic-decision-value"></span>')
				.text(reason || t("blocked"))
				.appendTo($block);
		}

		// Item 2: same settled guard as _list_row() above.
		const state = this._is_settled(row) ? ic_settled_expiry_state(row) : ic_expiry_state(row);
		const $expiry = $('<div class="ic-decision-expiry"></div>')
			.addClass(`ic-tone--${state.tone}`)
			.appendTo($band);
		$('<span class="ic-decision-label"></span>').text(t("expiry_state")).appendTo($expiry);
		$('<span class="ic-decision-value"></span>').text(state.long).appendTo($expiry);

		const gregorian = ic_date(row.iqama_expiration_date);
		if (gregorian && state.long !== gregorian) {
			$('<span class="ic-decision-dates"></span>')
				.text(gregorian)
				.appendTo($expiry);
		}

		return $band;
	},

	// Band 4. The amount due is the number the operator is about to authorise, so
	// it is the largest number in the column. D-17: a fee nobody calculated says
	// so, instead of rendering 0.00 as though nothing were owed.
	_detail_money($fixed, row) {
		const $band = $('<div class="ic-money"></div>').appendTo($fixed);
		const due = this._due_amount([row]);

		const $due = $('<div class="ic-money-due"></div>').appendTo($band);
		$('<span class="ic-money-label"></span>').text(t("amount_due")).appendTo($due);
		$('<span class="ic-money-value ic-num"></span>')
			.toggleClass("ic-money-value--none", !ic_has_amount(due))
			.text(ic_money_or_none(due))
			.appendTo($due);

		const $sadad = $('<div class="ic-money-sadad"></div>').appendTo($band);
		$('<span class="ic-money-label"></span>').text(t("sadad_number")).appendTo($sadad);

		if (!row.sadad_invoice) {
			$('<span class="ic-money-value ic-money-value--none"></span>')
				.text(t("not_captured"))
				.appendTo($sadad);
			return $band;
		}

		$('<span class="ic-money-value ic-latn"></span>').text(row.sadad_invoice).appendTo($sadad);
		$('<button class="ic-btn ic-copy" type="button"></button>')
			.text(t("copy"))
			.attr("aria-label", `${t("copy")} — ${t("sadad_number")}`)
			.on("click", () => this._copy_text(row.sadad_invoice))
			.appendTo($sadad);

		return $band;
	},

	_copy_text(value) {
		const text = String(value === null || value === undefined ? "" : value);
		if (!text) return;
		this._write_clipboard(text, `<span>${ic_escape(text)}</span>`)
			.then(() => frappe.show_alert({ message: t("toast_copied"), indicator: "green" }, 4))
			.catch(() => this._fallback_dialog(text));
	},

	// Band 6. History is the least actionable block in the column and it was
	// taking the most room, so it folds, and its summary carries what a glance
	// needs: how many events, and how long ago the last one was.
	//
	// D-18: nine consecutive rows of the same address are one event to a reader.
	// Consecutive events by one person are grouped under a single header carrying
	// that person's real name and avatar, and the address moves to the title.
	// D-14: each row says how long ago, with the full stamp on hover, no seconds.
	// R22-3: a Version diff value that already reached us HTML-escaped (an
	// external sync note with entities baked in, e.g. "status &gt; Awaiting
	// Renewal" for a literal "status -> Awaiting Renewal") showed those
	// entities as literal text -- ic_history_value()/.text() never decode,
	// by design, since a value that was never escaped needs none. This
	// decodes once, through the browser's own parser, so the DOM shows the
	// same text an unescaped value would have produced.
	_history_text(fieldname, value) {
		const text = ic_history_value(fieldname, value);
		if (!text) return "—";
		return $("<textarea></textarea>").html(text).text();
	},

	_render_history($scroll, row) {
		const $section = $('<details class="ic-history"></details>')
			.prop("open", Boolean(this.history_open))
			.on("toggle", (event) => {
				this.history_open = Boolean(event.currentTarget.open);
			})
			.appendTo($scroll);

		const $title = $('<summary class="ic-history-title"></summary>')
			.text(t("history"))
			.appendTo($section);
		const $body = $('<ol class="ic-history-list"></ol>').appendTo($section);
		$('<li class="ic-history-empty text-muted"></li>').text(t("loading")).appendTo($body);

		this._load_history(row).then((entries) => {
			if (this.focus !== row.name) return null;
			return this._load_users(entries.map((entry) => entry.who)).then(() => {
				if (this.focus !== row.name) return;
				this._paint_history($title, $body, entries);
			});
		});

		return $section;
	},

	_paint_history($title, $body, entries) {
		$body.empty();

		if (!entries.length) {
			$title.text(t("history_n", ic_count(0)));
			$('<li class="ic-history-empty text-muted"></li>')
				.text(t("history_empty"))
				.appendTo($body);
			return;
		}

		$title.text(t("history_head", ic_count(entries.length), ic_since(entries[0].when)));

		let who;
		let $group = null;
		entries.forEach((entry) => {
			if (entry.who !== who) {
				who = entry.who;
				const name = this._user_name(who);
				const $head = $('<li class="ic-history-by"></li>').appendTo($body);
				this._avatar({ employee_name: name }, "avatar-small").appendTo($head);
				$('<span class="ic-history-who"></span>')
					.attr("title", who || "")
					.text(name)
					.appendTo($head);
				$group = $('<li class="ic-history-group"></li>').appendTo($body);
			}

			const $item = $('<div class="ic-history-item"></div>').appendTo($group);
			$('<span class="ic-history-when"></span>')
				.attr("title", ic_datetime(entry.when))
				.text(ic_since(entry.when))
				.appendTo($item);
			// Item 3 (round 8c): a value change used to render as ONE concatenated
			// sentence -- "label: old -> new" as a single text node -- which the
			// owner read as prose, not data. Every visible piece is now its own
			// element: the field label, the old value, a marker element (never a
			// character joined into a string), and the new value. Both values
			// carry the SAME .indicator-pill + ic-pill--{tone} treatment the live
			// status chip wears (row ~760 above), via ic_status_tone(), so a status
			// value reads as a status here too; --old/--new tell the old one to
			// render as superseded and the new one as current. Every string still
			// passes through ic_history_value()/ic_label() exactly as before --
			// nothing raw reaches the DOM. F-09's title= survives as a plain-text
			// fallback on the wrapper for the same long-value hover.
			const to_text = this._history_text(entry.fieldname, entry.to);
			const $to = $('<span class="ic-history-value ic-history-value--new"></span>')
				.attr("title", to_text)
				.text(to_text);

			const $what = $('<span class="ic-history-what"></span>').appendTo($item);
			$('<span class="ic-history-field"></span>').text(entry.label).appendTo($what);

			if (entry.from === undefined) {
				$to.appendTo($what);
			} else {
				const from_text = this._history_text(entry.fieldname, entry.from);
				// K-33: IC_FLOW_ARROW (ic_i18n.js) keys off IC_IS_RTL so the glyph
				// always points from the action to the resulting status, not
				// backwards through an Arabic run.
				$('<span class="ic-history-value ic-history-value--old"></span>')
					.attr("title", from_text)
					.text(from_text)
					.appendTo($what);
				$(`<span class="ic-history-arrow" aria-hidden="true">${IC_FLOW_ARROW}</span>`).appendTo($what);
				$to.appendTo($what);
			}
		});
	},

	// One action bar in view 1, at the foot of the detail column. The page shell
	// builds it once as this.$actions so the framework head stays empty, so the
	// bar is moved here rather than rebuilt; the buttons that act on the focused
	// record go into a slot inside it that is emptied on every render.
	//
	// The bar must never run wider than the column it sits in. Five free-flowing
	// buttons put three of them past the right edge of a 483px detail column
	// with no way to reach them, so at most one primary and one secondary stay
	// on the bar and everything else answers from More. A destructive
	// transition is never promoted: it is only ever reachable through the menu.
	_render_actionbar($detail, row) {
		if (!this.$actions) return;
		const $bar = this.$actions.appendTo($detail);

		let $slot = $bar.children(".ic-actionbar-row").first();
		if (!$slot.length) $slot = $('<span class="ic-actionbar-row"></span>').prependTo($bar);
		$slot.empty();

		if (!row) return;

		const entries = this._detail_entries(row);
		// R17-A: this.$view already carries .ic-narrow, toggled by
		// iqama_control.js's own ResizeObserver at IC_NARROW_MAX (1023, element
		// inline-size) — read here rather than opening a second observer. One
		// primary slot under it, two above it; everything else still answers
		// from the More menu below.
		const narrow = this.$view && this.$view.hasClass("ic-narrow");
		const shown = entries
			.filter((entry) => !entry.destructive && !entry.disabled && !entry.always_more)
			.slice(0, narrow ? 1 : 2);
		// F-04: the fixed slots hold only state-specific transitions. Report an
		// issue, Schedule for later and Copy row always answer from here instead,
		// and Reject sorts last so the danger token never leads the menu.
		const folded = entries
			.filter((entry) => shown.indexOf(entry) < 0)
			.sort((a, b) => Number(Boolean(a.destructive)) - Number(Boolean(b.destructive)));

		shown.forEach((entry, index) => {
			const $button = $('<button class="ic-btn" type="button"></button>')
				.text(entry.label)
				.on("click", entry.action)
				.appendTo($slot);
			// The design carries one dark button per bar: the workflow action.
			if (!index) $button.addClass("ic-btn--primary");
		});

		if (!folded.length) return;

		const menu = this._dropdown({
			wrap_class: "ic-actionbar-menu",
			button_class: "ic-btn ic-more-actions",
			list_class: "ic-head-menu-list ic-drop-list",
			item_class: "ic-head-menu-item",
			label: t("more_actions"),
		});
		folded.forEach((entry) => menu.add(entry));
		menu.$el.appendTo($slot);
	},

	// Everything the focused record can be asked to do, in the order the bar
	// promotes from: the workflow transitions this status allows, then the two
	// payment requests, then the row export. Payment follows the same
	// HIDE-by-status convention ic_legal_actions() already uses above it: a
	// row that has not reached IC_PAYABLE_STATUS contributes no payment entry
	// at all, rather than two buttons disabled for a reason the status column
	// already states. Once the status qualifies, a type still blocked on DATA
	// readiness (missing SADAD number, zero amount, a request that already
	// exists) keeps its reason on the entry so the menu can show it disabled
	// with that reason as its title.
	_detail_entries(row) {
		const entries = ic_legal_actions([row], this.can_write).map((action) => ({
			label: ic_label(action.label),
			destructive: action.name === "reject",
			// F-04: the fixed action-bar contract keeps these two out of the
			// primary slots even when nothing else is legal on the row, so they
			// never take a slot a state-specific transition should hold.
			always_more: action.name === "flag_issue" || action.name === "schedule",
			disabled: action.disabled,
			reason: action.reason,
			action: () => this._run_action(action, [row]),
		}));

		// K-16: the detail bar acts on this ONE row. Mutating this.selected here
		// used to silently replace whatever the operator had ticked in bulk;
		// passing rows straight into _create_pr (ic_actions.js) removes the need
		// to touch selection state at all, so a cancel leaves the bulk selection
		// exactly as it was.
		//
		// R16-L: gated on status here, at the ONE call site that speaks for a
		// single row, so "not yet payable" reads as no button rather than two
		// disabled ones. The bulk call site below is untouched — a mixed
		// selection's all-vs-some question is still the owner's to answer.
		if (row.status === IC_PAYABLE_STATUS) {
			this._payment_entries([row], (type) => this._create_pr(type, [row])).forEach((entry) =>
				entries.push(entry)
			);
		}

		entries.push({
			label: t("act_copy_row"),
			always_more: true,
			action: () => this._export([row]),
		});
		return entries;
	},

	_toggle(name) {
		this._pick(name, false);
	},

	// Shift-click extends from the last row the operator touched to this one
	// over the rendered order, and gives the whole range the state this row is
	// moving to. A plain click toggles one row and becomes the new anchor.
	_pick(name, extend) {
		if (!this._is_pickable(this._row(name))) return;
		const order = this._order || [];
		const from = order.indexOf(this._anchor);
		const to = order.indexOf(name);

		if (extend && from >= 0 && to >= 0) {
			const on = !this.selected.has(name);
			const lo = Math.min(from, to);
			const hi = Math.max(from, to);
			for (let at = lo; at <= hi; at++) {
				if (!this._is_pickable(this._row(order[at]))) continue;
				if (on) this.selected.add(order[at]);
				else this.selected.delete(order[at]);
			}
		} else if (this.selected.has(name)) {
			this.selected.delete(name);
		} else {
			this.selected.add(name);
		}

		this._anchor = name;
		this._repaint_selection();
	},

	// D-19: "احمد عبدالقادر عبدالقيوم عبدالرحمن" and "عبدالله فهد" both reduce to
	// "اع" under first-plus-last initials, and dozens of names here begin with
	// عبد. An Arabic name therefore carries its whole first name in the frame,
	// and the frame stops being a fixed square to hold it.
	// ITEM 1: the real employee photo when one has been fetched
	// (_load_employee_photos() in ic_store.js), the first word of the name
	// otherwise — never the two-letter initials the owner asked off. The
	// <img> itself carries the fallback: a photo that 404s clears the cached
	// URL and repaints as the same first-name text a photo-less row shows,
	// silently, never as a broken-image icon.
	_avatar_initials(name) {
		const parts = String(name || "")
			.split(/\s+/)
			.filter(Boolean);
		if (!parts.length) return "?";
		const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
		return letters.toUpperCase();
	},

	_avatar(row, size) {
		const name = ic_person_name(row.employee_name || row.employee || "");
		const photo = row.employee ? this._employee_photo(row.employee) : "";
		const $avatar = $('<span class="avatar"></span>').addClass(size).attr("title", name);
		const $frame = $('<div class="avatar-frame"></div>').appendTo($avatar);
		if (photo) {
			$('<img class="avatar-frame-img" alt="">')
				.attr("src", photo)
				.on("error", () => {
					this._photo_failed(row.employee);
				})
				.appendTo($frame);
		} else {
			$frame.text(this._avatar_initials(name));
		}
		return $avatar;
	},

	_render_fields($parent, row, fields) {
		fields.forEach((fieldname) => {
			if (fieldname === "payment_requests") {
				// F-17: the two PR reference fields name different requests — the
				// work permit and the iqama renewal — so each gets its own labeled
				// row instead of one combined, indistinguishable line.
				[
					[row.pr_reference, t("pr_row_work_card")],
					[row.pr_reference_2, t("pr_row_iqama")],
				]
					.filter(([name]) => Boolean(name))
					.forEach(([name, label]) => {
						const $field = this._field($parent, label, "");
						$("<a></a>")
							.attr("href", frappe.utils.get_form_link("Payment Requisition", name))
							.text(name)
							.appendTo($field.find(".ic-field-value").empty());
					});
				return;
			}

			// R16-L: _detail_decision() already prints this, once, in the
			// decision band above the grid, with its own critical tone. A
			// second plain copy here just repeated the same string.
			if (fieldname === "reason_of_preventing_renewal" || fieldname === "reason_of_not_renew") return;

			const raw = row[fieldname];
			// G-10: a fieldname missing from IC_FIELD_LABELS is skipped rather
			// than shown under its own raw key — the same guard ic_store.js:409
			// already applies to the history feed, now applied here too so this
			// was the one place on the page a field could still fall back to it.
			if (!IC_FIELD_LABELS[fieldname]) return;
			const label = ic_label(IC_FIELD_LABELS[fieldname]);

			if (fieldname === "file_no") {
				const file_label = ic_file_no_label(raw);
				if (!file_label) return;
				this._field($parent, label, file_label);
				return;
			}

			// D-17: a money field left at zero is a fee nobody has calculated,
			// not a bill of nothing. It says so and keeps its slot, where before
			// it dropped out of the grid entirely and the operator could not
			// tell a missing fee from a missing lens.
			if (IC_MONEY_FIELDS.includes(fieldname)) {
				this._field(
					$parent,
					label,
					ic_money_or_none(raw),
					ic_has_amount(raw) ? "" : "ic-field--missing"
				);
				return;
			}

			if (fieldname === "sadad_invoice" && !raw) {
				this._field($parent, label, t("not_captured"), "ic-field--missing");
				return;
			}
			if (raw === null || raw === undefined || raw === "") return;

			// D-14: no date on this page is built by hand and none renders
			// seconds. The two expiry dates carry the Umm al-Qura reading under
			// the Gregorian one, because the ministry writes in it.
			if (IC_DATE_FIELDS.includes(fieldname)) {
				const $field = this._field($parent, label, ic_date(raw));
				const hijri = fieldname.indexOf("expiration") >= 0 ? ic_hijri(raw) : "";
				if (hijri) {
					$('<span class="ic-field-hijri"></span>')
						.attr("title", t("hijri_date"))
						.text(hijri)
						.appendTo($field);
				}
				return;
			}

			// K-26: a raw DocType value (a duration, a status) printed here reads
			// as Latin text inside an otherwise-Arabic grid. ic_label falls back
			// to String(value) for anything not in the dictionary, so this is
			// safe for every other field type already reaching this line.
			this._field($parent, label, ic_label(raw));
		});
	},

	_field($parent, label, value, extra) {
		const $field = $('<div class="ic-field"></div>').addClass(extra || "").appendTo($parent);
		$('<span class="ic-field-label"></span>').text(label).appendTo($field);
		$('<span class="ic-field-value"></span>').text(value).appendTo($field);
		return $field;
	},

	_row_flags(row) {
		const $flags = $('<div class="ic-flags"></div>');
		let shown = false;

		if (cint(row.iqama_renewal_issue) || row.status === IC_BLOCKED_STATUS) {
			$('<span class="ic-flag ic-flag--stop"></span>').text(t("blocked")).appendTo($flags);
			shown = true;
		}
		if (!IC_ALLOWED_EMPLOYEE_STATUS.includes(row.employee_status)) {
			// K-26: routed through ic_label so Suspended/Left/On Leave read in
			// Arabic instead of the raw DocType value.
			$('<span class="ic-flag ic-flag--warn"></span>')
				.text(ic_label(row.employee_status) || t("inactive"))
				.appendTo($flags);
			shown = true;
		}
		if (row.status === IC_PAYABLE_STATUS && !row.sadad_invoice) {
			$('<span class="ic-flag ic-flag--stop"></span>').text(t("no_sadad")).appendTo($flags);
			shown = true;
		}
		// D-17: the fees were never calculated, so this record cannot be paid
		// and must not be counted into a payment batch.
		if (!this._is_settled(row) && ic_fees_missing(row)) {
			$('<span class="ic-flag ic-flag--warn"></span>').text(t("fees_missing")).appendTo($flags);
			shown = true;
		}
		if (row.pr_status) {
			$('<span class="ic-flag ic-flag--done"></span>').text(ic_label(row.pr_status)).appendTo($flags);
			shown = true;
		}
		// R16-L: the "label: date" chip this block used to add here fused two
		// values into one text node, breaking the page's own label-and-value
		// rule (H-04). reschedule_date is in IC_LENSES.operations and
		// .all (ic_config.js), so _render_fields() already prints it above,
		// labeled and valued like every other field — one presentation, not
		// two. ic_batch.js's own "Rescheduled" chip is a different surface
		// (the batch board row) and is untouched.
		const nitaqat = this.nitaqat[row.corporation];
		if (nitaqat) {
			$('<span class="ic-flag"></span>')
				.addClass(`ic-band--${ic_band_key(nitaqat)}`)
				.text(t("nitaqat_v", nitaqat))
				.appendTo($flags);
			shown = true;
		}
		return shown ? $flags : null;
	},
});

// Copyright (c) 2026, AFMCO and contributors

// View 3 — Batch, rebuilt to Figma node 9:309. Three bands: a 56px queue-card
// header, then a sunk body holding one 916 card and a 300 rail. The design's
// rows are wireframe bars, so their heights are read here as the type ramp —
// the 9px bar is the primary line, the 7px bar the secondary one.
//
// H-12 round 9: the strip under the question heading used to carry the risk
// bands (_render_bands, an ic_triage.js builder for expiry prioritisation) and
// the rail used to open with _paint_rail (ic_triage.js's saved-view status
// list). Neither belongs to a screen that is already scoped to one workflow
// step by the queue cards above it — both were a second, redundant filter
// layer riding on functions this file happens to share the prototype with.
// Batch keeps exactly one filter surface (the strip: scope + the folded
// department/project/include_settled form + the checked count) and the rail
// now opens straight on the three sketch cards.

Object.assign(IqamaControl.prototype, {
	// RAIL-IN-SPEC: left card 916 fixed, gap 16, right rail 300 fixed
	// (node 9:334/9:335/9:431) — the left column is a CARD, not a rail. The
	// one rail this view carries is the right column, .ic-b-rail, built by
	// _paint_outcome() into its three sketch cards.
	_render_batch() {
		const $batch = $('<div class="ic-batch"></div>').appendTo(this.$view);
		this.$line = $('<nav class="ic-b-line"></nav>').appendTo($batch);
		const $work = $('<div class="ic-b-body"></div>').appendTo($batch);
		this.$picker = $('<section class="ic-b-card"></section>').appendTo($work);
		this.$rail_pane = $('<aside class="ic-b-rail"></aside>').appendTo($work);
		this.$side = $('<aside class="ic-b-side" data-ic-filters data-ic-slot="rail"></aside>').appendTo($work);

		this._paint_stage_line(this.$line);
		const legal = this._step_legal();
		this._paint_picker(this.$picker, legal);
		this._paint_outcome(this.$rail_pane, legal);
	},

	// owner note.6: the queue cards, the picker and the rail are three regions.
	// Pressing a queue card repaints the picker and the rail and leaves the
	// cards standing; ticking a box repaints neither.
	_repaint_batch() {
		this._repaint(this.$line, ($el) => this._paint_stage_line($el));
		const legal = this._step_legal();
		this._repaint(this.$picker, ($el) => this._paint_picker($el, legal));
		this._repaint(this.$rail_pane, ($el) => this._paint_outcome($el, legal));
	},

	// The rows this step can act on. A blocked record and one whose fees were
	// never calculated cannot be moved, so they stand out of the batch and are
	// counted against it in the picker's own heading rather than silently
	// dropped. The intervention card is the one card that must keep them: it
	// exists to show them.
	_step_ready(step) {
		const at_step = this._step_rows(step.statuses);
		if (step.intervention) return at_step;
		let rows = at_step.filter((row) => !this._is_blocked(row));
		if (step.key === "payment") rows = rows.filter((row) => !ic_fees_missing(row));
		return rows;
	},

	_step() {
		return IC_STEPS.find((entry) => entry.key === this.step) || IC_STEPS[0];
	},

	_go_step(key) {
		this.step = key;
		this.selected.clear();
		this._anchor = null;
		this.shown = IC_PAGE_ROWS;
		this._repaint(this.$line, ($el) => this._paint_stage_line($el));
		const legal = this._step_legal();
		this._repaint(this.$picker, ($el) => this._paint_picker($el, legal));
		this._repaint(this.$rail_pane, ($el) => this._paint_outcome($el, legal));
	},

	_paint_stage_line($line) {
		const step = this._step();
		const stages = IC_STEPS.filter((entry) => !entry.intervention);
		const at = stages.findIndex((entry) => entry.key === step.key);

		stages.forEach((entry, index) => {
			if (index) {
				$('<span class="ic-b-stage-link" aria-hidden="true"></span>')
					.toggleClass("is-done", at > -1 && index <= at)
					.appendTo($line);
			}

			const on = entry.key === step.key;
			const $stage = $('<button class="ic-b-stage" type="button"></button>')
				.toggleClass("is-on", on)
				.toggleClass("is-done", at > -1 && index < at)
				.attr("aria-current", on ? "true" : null)
				.on("click", () => this._go_step(entry.key))
				.appendTo($line);
			$('<span class="ic-b-stage-dot" aria-hidden="true"></span>').appendTo($stage);
			$('<span class="ic-b-stage-label"></span>').text(ic_label(entry.label)).appendTo($stage);
		});

		// The intervention step is a branch, not a pipeline position — a record
		// reaches it from ops, legal, payment or renewal, so it cannot sit at one
		// index in the is-done math above without falsely marking some of those
		// steps done or ahead of where they are. It gets its own button here,
		// same shape as the six above (dot, label, click -> _go_step), carrying
		// only is-on/aria-current — no is-done, no connector line.
		const branch = IC_STEPS.find((entry) => entry.intervention);
		if (branch) {
			const on = branch.key === step.key;
			const $stage = $('<button class="ic-b-stage" type="button"></button>')
				.toggleClass("is-on", on)
				.attr("aria-current", on ? "true" : null)
				.on("click", () => this._go_step(branch.key))
				.appendTo($line);
			$('<span class="ic-b-stage-dot" aria-hidden="true"></span>').appendTo($stage);
			$('<span class="ic-b-stage-label"></span>').text(ic_label(branch.label)).appendTo($stage);
		}
	},

	_paint_picker($card, legal) {
		const step = this._step();
		const at_step = this._step_rows(step.statuses);
		const rows = this._step_ready(step);

		this._batch_ask($card, step, rows, at_step);
		this._batch_strip($card, rows);
		this._batch_rows($card, rows);
		this._render_footer($card, legal);
	},

	// D-27: the heading used to read "Update SADAD Number these 440 records?"
	// and, at an empty step, "Review these 0 records?". It is the verb and the
	// count now, and where the batch is narrower than the queue it stands in it
	// says by how much and why, which is what D-09 asks for.
	_batch_ask($card, step, rows, at_step) {
		const $ask = $('<header class="ic-b-ask"></header>').appendTo($card);
		if (!rows.length) return $ask;

		const action = this._primary_action(rows);
		$('<h2 class="ic-b-ask-title"></h2>')
			.text(
				action
					? t("count_suffix", ic_label(action.label), ic_count(rows.length))
					: t("review_only_step")
			)
			.appendTo($ask);

		const held = at_step.length - rows.length;
		$('<p class="ic-b-ask-sub"></p>')
			.text(held > 0 ? t("ready_of", ic_count(rows.length), ic_count(at_step.length)) : t("deselect_hint"))
			.appendTo($ask);

		// K-13: the summed ask, in money — same field, same rows, as the
		// per-row figure on each line below and the ic_actions.js confirm
		// face, so the three never disagree.
		const step_total = this._money_total(rows);
		if (ic_has_amount(step_total)) {
			const picked_total = this._money_total(this._picked_at_step(rows));
			const $amount = $('<p class="ic-b-ask-amount ic-num"></p>').appendTo($ask);
			$('<span class="ic-b-ask-amount-label"></span>').text(t("money_committing")).appendTo($amount);
			$('<span class="ic-b-ask-amount-value"></span>')
				.toggleClass("ic-money-value--none", !ic_has_amount(picked_total))
				.text(ic_money(picked_total))
				.appendTo($amount);
			$('<span class="ic-b-ask-amount-of"></span>')
				.text(t("money_of_step", ic_money_or_none(step_total)))
				.appendTo($amount);
		}

		return $ask;
	},

	// The action bar ends on one forward button. Reject is the destructive
	// sibling that sits before it; everything else keeps the order IC_ACTIONS
	// declares. An action the rows cannot take yet is never the forward one.
	//
	// ic_legal_actions() hands back a fresh copy of each entry on every call, so
	// a caller that needs to compare an action against the primary must pick the
	// primary out of the SAME list it is filtering — never out of a second call.
	// K-15: returns null, not the destructive action, when nothing else is
	// legal — a null primary leaves reject in the plain-button set
	// _render_footer already builds below. Promoting it to the dark button
	// contradicted this file's own comment above about reject never being
	// "the forward one"; it fired on the Legal step, on intervention with 0
	// checked, and on any mixed selection whose only shared action is reject.
	_pick_primary(actions) {
		return actions.find((action) => action.name !== "reject" && !action.disabled) || null;
	},

	_primary_action(rows) {
		return this._pick_primary(ic_legal_actions(rows, this.can_write));
	},

	// _render_batch(), _repaint_batch() and _go_step() each draw the footer and
	// the outcome rail in the same pass, off the same rows — ic_legal_actions is
	// O(actions x rows), so this computes it once and both draws share the
	// result, the same pairing _repaint_batch_selection() already uses below.
	_step_legal() {
		const rows = this._step_ready(this._step());
		const picked = this._selected_rows();
		return ic_legal_actions(picked.length ? picked : rows, this.can_write);
	},

	// H-12: this screen's one filter surface is .ic-b-side (data-ic-slot="rail"),
	// which _place_filters() docks the relocated framework form into — scope,
	// then the folded department/project/include_settled group behind "more
	// filters". This strip carries only the checked count, hard end of the
	// row. No second layer — _render_bands() (ic_triage.js's expiry-risk
	// chips) is deliberately not called here: the queue cards above already
	// scope every row on screen to one workflow step, so a second, finer pass
	// over expiry risk would narrow an already-narrow batch rather than help
	// pick one. Risk-based triage stays the triage screen's job.
	_batch_strip($card, rows) {
		const $strip = $('<div class="ic-b-strip"></div>').appendTo($card);

		this.$checked = $('<span class="ic-b-checked ic-num"></span>').appendTo($strip);
		this._paint_checked(rows);
	},

	_paint_checked(rows) {
		if (!this.$checked || !this.$checked.length) return;
		const checked = rows.filter((row) => this.selected.has(row.name)).length;
		this.$checked.text(t("checked_of", ic_count(checked), ic_count(rows.length)));
	},

	_batch_rows($card, rows) {
		const $rows = $('<div class="ic-b-rows"></div>').appendTo($card);

		if (!rows.length) {
			this._empty_state($rows, t("step_empty"));
			return;
		}

		this._batch_all($rows, rows);

		// Its own container, so the zebra counts data rows alone and the first
		// one is the tinted one.
		const $list = $('<div class="ic-b-list"></div>').appendTo($rows);
		const page = this._page_rows(rows);
		page.forEach((row) => this._pick_row(row).appendTo($list));

		// D-13: the picker's numbers are all over the rows LOADED at this step,
		// which the fetch caps at IC_ROW_LIMIT. The queue card above carries the
		// true count of the step, so the foot says what this card is holding and,
		// when the cap is what is holding it, says that too.
		const $foot = $('<div class="ic-b-foot text-muted"></div>').appendTo($rows);
		this._paint_batch_foot($foot, rows, $list);
	},

	// D-05: the same explicit page the triage list draws, appended rather than
	// rebuilt, so a batch of 500 is never 500 rows of DOM until it is asked for.
	_paint_batch_foot($foot, rows, $list) {
		const drawn = this._page_rows(rows).length;
		$('<span class="ic-b-shown ic-num"></span>')
			.text(t("showing_of", ic_count(drawn), ic_count(rows.length)))
			.appendTo($foot);

		if (drawn >= rows.length) {
			// F-18: this used to fire whenever the fetch cap was hit ANYWHERE on
			// the board, so a queue that was itself fully loaded still said
			// "narrow the filters to reach the rest" with no rest to reach. It
			// now compares this step's own loaded count against its true total.
			const at_step_total = this._step_rows(this._step().statuses).length;
			const step_total = this._step_count(this._status_counts(), this._step().statuses);
			if (this.rows.length >= IC_ROW_LIMIT && step_total !== null && at_step_total < step_total) {
				$('<span class="ic-truncated"></span>').text(t("narrow_filters")).appendTo($foot);
			}
			return $foot;
		}

		$('<button class="ic-btn ic-list-more" type="button"></button>')
			.text(t("load_more", ic_count(Math.min(IC_PAGE_ROWS, rows.length - drawn))))
			.on("click", () => {
				const from = this.shown || IC_PAGE_ROWS;
				this.shown = from + IC_PAGE_ROWS;
				rows.slice(from, this.shown).forEach((row) => this._pick_row(row).appendTo($list));
				$foot.empty();
				this._paint_batch_foot($foot, rows, $list);
				$list.find(IC_AUTO_DIR).attr("dir", "auto");
			})
			.appendTo($foot);
		return $foot;
	},

	_batch_all($rows, rows) {
		const pickable = rows.filter((row) => this._is_pickable(row));
		const all = pickable.length > 0 && pickable.every((row) => this.selected.has(row.name));
		const $all = $('<label class="ic-b-all"></label>').appendTo($rows);

		this.$batch_all_box = $('<input type="checkbox" class="ic-b-check">')
			.prop("checked", all)
			.on("change", () => {
				pickable.forEach((row) =>
					all ? this.selected.delete(row.name) : this.selected.add(row.name)
				);
				this._repaint_selection();
			})
			.appendTo($all);
		$('<span class="ic-b-all-text"></span>')
			.text(t("select_all_n", ic_count(pickable.length)))
			.appendTo($all);
	},

	// owner note.6: ticking a box in the batch moves the boxes, the checked
	// counter and the footer's buttons. The queue cards, the rail and the rows
	// themselves are left where they are.
	_repaint_batch_selection() {
		if (!this.$picker || !this.$picker.length) {
			this._repaint_data();
			return;
		}
		const rows = this._step_ready(this._step());

		this.$picker.find(".ic-b-row").each((index, node) => {
			const $row = $(node);
			const on = this.selected.has($row.attr("data-name"));
			$row.toggleClass("is-checked", on);
			$row.find(".ic-b-check").prop("checked", on);
		});

		if (this.$batch_all_box && this.$batch_all_box.length) {
			this.$batch_all_box.prop(
				"checked",
				rows.some((row) => this._is_pickable(row)) &&
					rows
						.filter((row) => this._is_pickable(row))
						.every((row) => this.selected.has(row.name))
			);
		}

		this._paint_checked(rows);

		const picked = this._selected_rows();
		const picked_total = this._money_total(this._picked_at_step(rows));
		this.$picker
			.find(".ic-b-ask-amount-value")
			.toggleClass("ic-money-value--none", !ic_has_amount(picked_total))
			.text(ic_money(picked_total));

		this.$picker.find(".ic-b-bar").remove();
		this._close_menus(null);

		const legal = ic_legal_actions(picked.length ? picked : rows, this.can_write);
		this._render_footer(this.$picker, legal);
		this._repaint(this.$rail_pane, ($el) => this._paint_outcome($el, legal));
	},

	// K-13: which of the two fee fields a row is still being asked to pay.
	// A row can owe both, across two separate requests, but is never asked
	// for both in the same figure — the type returned is whichever has not
	// yet had a request made (row.pr_status); a row already carrying both
	// (IC_BOTH) has nothing left to ask for and returns null.
	_row_payment_config(row) {
		const type = Object.keys(IC_PAYMENT_TYPES).find(
			(key) => row.pr_status !== key && row.pr_status !== IC_BOTH
		);
		return type ? IC_PAYMENT_TYPES[type] : null;
	},

	_row_payment_amount(row) {
		const config = this._row_payment_config(row);
		return config ? flt(row[config.amount_field]) : 0;
	},

	_money_total(rows) {
		return rows.reduce((sum, row) => sum + this._row_payment_amount(row), 0);
	},

	_picked_at_step(rows) {
		return this._selected_rows().filter((row) => rows.includes(row));
	},

	// Six columns, to the design: checkbox 16, avatar 24, name 160 fixed, detail
	// flex, status pill 90 fixed, outcome chip 70 fixed.
	_pick_row(row) {
		// K-18: a settled record (Renewed) is closed work — the same guard
		// ic_triage.js's _list_row already applies, so a new expiry that has
		// since passed cannot repaint a finished row critical here while
		// triage shows it settled.
		const settled = this._is_settled(row);
		const state = settled ? ic_settled_expiry_state(row) : ic_expiry_state(row);
		const urgency = settled ? "none" : ic_urgency(ic_days_left(row));
		const checked = this.selected.has(row.name);

		const $row = $('<label class="ic-b-row"></label>')
			.toggleClass("is-checked", checked)
			.attr("data-name", row.name);

		if (settled) {
			$('<span class="ic-b-nopick" aria-hidden="true"></span>').appendTo($row);
		} else {
			$('<input type="checkbox" class="ic-b-check">')
				.prop("checked", checked)
				.attr("aria-label", t("select"))
				.on("change", () => this._toggle(row.name))
				.appendTo($row);
		}

		$('<span class="ic-b-avatar" aria-hidden="true"></span>')
			.toggleClass("ic-avatar--word", ic_is_arabic(ic_row_name(row)))
			.text(ic_initials(ic_row_name(row)))
			.appendTo($row);

		$('<span class="ic-b-name"></span>').text(ic_row_name(row)).appendTo($row);

		// There is no project field on the DocType — department and cost_center
		// are the dimension, and ic_project_label() is the one place that reads
		// either into the label an operator recognises. company_name is the
		// fallback for the rows it leaves blank, never a second label source.
		const $detail = $('<span class="ic-b-detail"></span>').appendTo($row);
		$('<span class="ic-b-org"></span>')
			.text(ic_project_label(row) || row.company_name || row.corporation || "")
			.appendTo($detail);

		if (this._is_blocked(row)) {
			// K-41: triage reads this same condition through the "blocked" key;
			// "flagged" resolves to a different Arabic word that already means
			// held-back elsewhere in IC_STR (ic_i18n.js) — one condition, one
			// word, on both screens.
			$('<span class="ic-b-flag"></span>').text(t("blocked")).appendTo($detail);
		}
		if (this._is_duplicate(row)) {
			$('<span class="ic-b-flag"></span>')
				.attr("title", t("duplicate_hint"))
				.text(t("duplicate"))
				.appendTo($detail);
		}

		// K-22: custom_reschedule_date was written (ic_utils.js schedule_for_later
		// patch) but never printed anywhere on this page. "Rescheduled" is
		// authorised at TRANSITIONS-FROM-CLIENT-SCRIPT.md:10. Batch half only —
		// the triage grid half of K-22's acc belongs to ic_triage.js, out of
		// scope this phase.
		if (row.status === "Rescheduled" && row.custom_reschedule_date) {
			$('<span class="ic-b-flag"></span>')
				.text(`${ic_label(IC_FIELD_LABELS.custom_reschedule_date)}: ${ic_date(row.custom_reschedule_date)}`)
				.appendTo($detail);
		}

		// K-13: the batch Payment step used to show no money at all, so the
		// operator ticked rows blind. This is the ACTIVE payment type's own
		// field (see _row_payment_amount below) — never _due_amount
		// (ic_store.js:652), which sums both fee fields and would print
		// roughly double.
		if (this._step().key === "payment") {
			const amount = this._row_payment_amount(row);
			$('<span class="ic-b-amount ic-num"></span>')
				.toggleClass("ic-money-value--none", !ic_has_amount(amount))
				.text(ic_money_or_none(amount))
				.appendTo($detail);
		}

		$('<span class="ic-b-status"></span>')
			.addClass(`ic-tone--${ic_status_tone(row.status)}`)
			.attr("title", ic_label(row.status))
			.text(ic_label(row.status))
			.appendTo($row);

		// D-16: the same expiry statement as the triage badge and the dashboard.
		$('<span class="ic-b-out ic-num"></span>')
			.addClass(`ic-days--${urgency}`)
			.attr("title", state.long)
			.text(state.short)
			.appendTo($row);

		return $row;
	},

	// H-11: three rail cards, the sketch's own order — what happens next, what
	// is flagged, what queues up behind this step. _paint_rail() (ic_triage.js's
	// saved-view status list) is deliberately NOT called here any more: the
	// queue cards this view opens with already are that same status list, so
	// painting it a second time inside the rail was a second copy of a filter
	// the operator had already used to get here, sitting in the one rail this
	// screen owns and the sketch draws as three plain cards, not a list.
	_paint_outcome($pane, legal) {
		const step = this._step();
		const rows = this._step_ready(step);
		const picked = this._selected_rows();

		this._outcome_next($pane, picked.length ? picked : rows, legal);
		this._outcome_flagged($pane, this._step_rows(step.statuses));
		this._outcome_queue($pane, step);
	},

	_rail_card($pane, title) {
		const $box = $('<section class="ic-b-rail-card"></section>').appendTo($pane);
		$('<h3 class="ic-b-rail-title"></h3>').text(title).appendTo($box);
		return $box;
	},

	_resulting_status(action) {
		if (action.fields) return "";
		const patch = action.patch({}, {});
		return patch.status || "";
	},

	_outcome_next($pane, rows, legal) {
		const $box = this._rail_card($pane, t("whats_next"));

		const actions = legal || ic_legal_actions(rows, this.can_write);
		if (!actions.length) {
			$('<div class="ic-empty text-muted"></div>')
				.text(t("review_only_step"))
				.appendTo($box);
			return;
		}

		const $list = $('<ul class="ic-b-next"></ul>').appendTo($box);
		actions.forEach((action) => {
			const status = this._resulting_status(action);
			const $item = $('<li class="ic-b-next-item"></li>').appendTo($list);
			$('<span class="ic-b-dotmark" aria-hidden="true"></span>').appendTo($item);
			$('<span class="ic-b-next-text"></span>')
				.attr("title", action.disabled ? action.reason : null)
				.text(status ? `${ic_label(action.label)}  ${IC_FLOW_ARROW}  ${ic_label(status)}` : ic_label(action.label))
				.appendTo($item);
		});
	},

	// F-18: a permanently-zero count was a full rail card reading "Flagged (0)
	// — No records held back" on every visit. The card is now only drawn once
	// there is something in it.
	_outcome_flagged($pane, rows) {
		const flagged = rows.filter((row) => this._is_blocked(row));
		if (!flagged.length) return;
		const $box = this._rail_card($pane, t("flagged_n", ic_count(flagged.length)));

		flagged.slice(0, IC_TABLE_ROWS).forEach((row) => {
			const $sub = $('<button class="ic-b-flagged" type="button"></button>')
				.on("click", () => this._focus_row(row.name))
				.appendTo($box);
			$('<span class="ic-b-flagged-name"></span>')
				.text(ic_row_name(row))
				.appendTo($sub);
			$('<span class="ic-b-flagged-why"></span>')
				.text(row.reason_of_preventing_renewal || ic_label(row.status))
				.appendTo($sub);
		});

		if (flagged.length > IC_TABLE_ROWS) {
			$('<div class="ic-b-more text-muted"></div>')
				.text(t("and_more", ic_count(flagged.length - IC_TABLE_ROWS)))
				.appendTo($box);
		}
	},

	// node:9:454 "Queue after this step": one row per step still ahead of this
	// one, in IC_STEPS' own order, each carrying that step's count over the
	// same _status_counts() base the queue cards above read — so this card can
	// never show a number the cards do not agree with. "Done" is the end of
	// the line, not a queue; "Needs intervention" is a side branch a record
	// only reaches by being flagged there directly, never by falling out of
	// this step, so neither gets a row here.
	_outcome_queue($pane, step) {
		const counts = this._status_counts();
		const at = IC_STEPS.findIndex((entry) => entry.key === step.key);
		const ahead = IC_STEPS.slice(at + 1).filter((entry) => !entry.intervention && entry.key !== "done");
		if (!ahead.length) return;

		const $box = this._rail_card($pane, t("queue_after_step"));
		const $list = $('<ul class="ic-b-queue-list"></ul>').appendTo($box);
		ahead.forEach((entry) => {
			const $item = $('<li class="ic-b-queue-row"></li>').appendTo($list);
			$('<span class="ic-b-queue-row-label"></span>').text(ic_label(entry.label)).appendTo($item);
			$('<span class="ic-b-queue-row-value ic-num"></span>')
				.text(ic_count_or_wait(this._step_count(counts, entry.statuses)))
				.appendTo($item);
		});
	},

	// Split bar: Back hard left, a spacer, then the destructive transitions and
	// the primary one last. It is bounded to the card, never to the page and
	// never fixed to the viewport.
	//
	// F-03: at 0 checked, `ic_legal_actions([])` short-circuits to an empty
	// list, so this bar used to carry only Back — a dead end. The action set is
	// now read off the step's ready rows whenever nothing is checked, so the
	// primary button is always drawn; it is disabled until a row is checked,
	// and its count reads 0 until then.
	_render_footer($card, legal) {
		const picked = this._selected_rows();
		const basis = picked.length ? picked : this._step_ready(this._step());
		const $bar = $('<div class="ic-b-bar"></div>').appendTo($card);

		$('<button class="ic-btn ic-b-back" type="button"></button>')
			.text(t("back"))
			.on("click", () => this._switch("triage"))
			.appendTo($bar);

		$('<span class="ic-b-bar-gap"></span>').appendTo($bar);

		const actions = legal || ic_legal_actions(basis, this.can_write);
		const primary = this._pick_primary(actions);

		actions
			.filter((action) => action !== primary)
			.forEach((action) => {
				const $button = $('<button class="ic-btn" type="button"></button>')
					// K-15: the stylesheet's danger treatment is bound to this
					// exact class, so reject still reads as destructive rather
					// than as just another plain button now that _pick_primary
					// (above) never promotes it.
					.toggleClass("ic-btn--danger", action.name === "reject")
					.text(t("count_suffix", ic_label(action.label), ic_count(picked.length)))
					.appendTo($bar);
				// D-22: an action the status allows but the record is not ready
				// for stays on the bar, disabled, carrying the reason. Dropping it
				// would leave the operator guessing why the button vanished.
				if (!picked.length) $button.prop("disabled", true);
				else if (action.disabled) $button.prop("disabled", true).attr("title", action.reason);
				else $button.on("click", () => this._run_action(action, picked));
			});

		// K-09: .ic-b-bar carries no More menu (H-12's one filter surface is
		// the strip above, not this bar), so the two payment-request types
		// ride here as plain buttons instead of folding into a menu this bar
		// does not have. Reserved for the Payment step only —
		// _payment_entries()'s own _skip_reason (ic_actions.js) already
		// requires status "Awaiting Payment", so anywhere else every entry
		// would read disabled for a reason that is really "wrong step". Same
		// builder, same _create_pr() the Triage bulk bar already calls, so
		// this is not a second writer. A Cancel-payment-request action
		// (expected action name "cancel_pr", landing in IC_ACTIONS via
		// ic_utils.js this round) needs no wiring here at all — it rides the
		// generic `actions` loop above like every other transition once it
		// is declared there.
		if (this._step().key === "payment") {
			this._payment_entries(picked, (type) => this._create_pr(type)).forEach((entry) => {
				const $button = $('<button class="ic-btn" type="button"></button>')
					.text(entry.label)
					.appendTo($bar);
				if (!picked.length) $button.prop("disabled", true);
				else if (entry.disabled) $button.prop("disabled", true).attr("title", entry.reason);
				else $button.on("click", entry.action);
			});
		}

		if (primary) {
			const $primary = $('<button class="ic-btn ic-btn--primary" type="button"></button>')
				.text(t("count_suffix", ic_label(primary.label), ic_count(picked.length)))
				.appendTo($bar);
			if (!picked.length) $primary.prop("disabled", true);
			else $primary.on("click", () => this._run_action(primary, picked));
		}
	},
});

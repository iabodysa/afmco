// Copyright (c) 2026, AFMCO and contributors

// View 2 — Dashboard, ROUND 9 FULL REDESIGN (H-09). The Figma sketch is the
// specification for this screen, not a reference: four full-width bands
// counting the shared header — header, a 120px KPI strip, a 192px chart band
// and a 299px table band. No side column, no rail, no filter band. Nothing is
// appended to board.$actions either, since the design gives this view no
// page-level action.
//
// H-10: this view declares no [data-ic-filters] host, so the shell's
// _place_filters() (iqama_control.js:361) leaves the scope group and the
// folded form detached — "a view that declares no host gets no filter
// surface" is the framework's own documented case for exactly this. The
// numbers on this view still read the page's shared filter state (status,
// include_settled, project, department, corporation, employee, expiry_to,
// only_with_sadad) because that state lives on `this`, not in the DOM; they
// are simply set from wherever the operator last placed them — the Triage
// rail, which owns its own [data-ic-filters] host (ic_triage.js:43) and is
// where "Include settled" (f_include_settled) is reachable. A dashboard
// summarises the operator's current working set; it does not carry a second
// copy of the query builder.

// D-10: a status holding less than this share of the population is gathered
// into the "Other" slice rather than drawn as a sliver nobody can hit.
const IC_SHARE_FLOOR = 0.02;

// D-12: the same track+fill+share markup _render_overdue_chart's hbars already
// draw (.ic-meter-share below), reused here as its own node so a KPI card can
// add the risk modifier and the title _paint_kpi wants on it. With no
// population declared there is no maximum to fill against, so no bar is drawn.
function ic_meter($card, count, total) {
	if (!total) return null;
	const share = Math.round((cint(count) / total) * 100);
	const $meter = $('<div class="ic-meter"></div>').appendTo($card);
	const $track = $('<span class="ic-meter-track"></span>').appendTo($meter);
	$('<span class="ic-meter-fill"></span>').css("inline-size", `${share}%`).appendTo($track);
	$('<span class="ic-meter-share"></span>')
		.text(t("share_of", ic_count(share), ic_count(total)))
		.appendTo($meter);
	return $meter;
}

Object.assign(IqamaControl.prototype, {
	// RAIL-IN-SPEC: Dashboard carries no rail and no filter band. .ic-board
	// stands directly in this.$view as a flex column of three full-width
	// bands under the shared header — the KPI strip, the chart band and the
	// table band, node 9:203's own count.
	_render_dashboard() {
		const $board = $('<div class="ic-board"></div>').appendTo(this.$view);
		this.$narrow = $('<p class="ic-board-narrow text-muted"></p>').appendTo($board);
		this.$kpi = $('<div class="ic-kpi"></div>').appendTo($board);
		this.$charts = $('<div class="ic-charts"></div>').appendTo($board);
		this.$today = $('<div class="ic-today"></div>').appendTo($board);

		this._paint_narrowings(this.$narrow);
		this._paint_kpi(this.$kpi);
		this._paint_charts(this.$charts);
		this._paint_today(this.$today);
	},

	// owner note.6: every band is repainted from the same state.
	_repaint_dashboard() {
		this._repaint(this.$narrow, ($el) => this._paint_narrowings($el));
		this._repaint(this.$kpi, ($el) => this._paint_kpi($el));
		this._repaint(this.$charts, ($el) => this._paint_charts($el));
		this._repaint(this.$today, ($el) => this._paint_today($el));
	},

	// K-31: one read-only line naming the narrowings _filters() (ic_store.js)
	// already applies unconditionally to every count on this view but that
	// this view never stated. status and risk are deliberately left out —
	// _count_by_status/_count_by_expiry already pass them through, so the
	// tiles and the charts already show their effect; naming them again here
	// would double-state what the numbers already disclose. No button: the
	// view tabs already return to triage in one press (H-10), and a legend
	// must not become a second filter host (_view_filter_allowlist().dashboard
	// stays empty).
	_paint_narrowings($el) {
		$el.text(this._dashboard_narrowings().join("  ·  "));
	},

	_dashboard_narrowings() {
		const parts = [];

		const corporation = this.corporation.get_value();
		if (corporation) parts.push(`${t("f_corporation")}: ${corporation}`);

		const cascade = this.project_cascade || { mode: "", value: "" };
		if (cascade.mode && cascade.value) {
			const label = cascade.mode === "cost_center" ? t("f_cost_center") : t("f_department");
			parts.push(`${label}: ${cascade.value}`);
		}

		const employee = this.employee.get_value();
		if (employee) parts.push(`${t("f_employee")}: ${employee}`);

		if (this.only_with_sadad.get_value()) parts.push(t("f_with_sadad"));
		if (this.include_settled.get_value()) parts.push(t("f_include_settled"));

		return parts;
	},

	// --- band 1, the KPI strip ------------------------------------------

	// D-12: the 4px rule under each tile was a bar with no declared maximum —
	// it was filled to the largest of the five tiles, which is a denominator
	// nothing on screen names. The tile states its share of the population
	// instead, and the population is the number the header and the rail rows
	// already show.
	_paint_kpi($strip) {
		IC_TILES.forEach((tile) => {
			const count = this._tile_count(tile);
			const total = this._tile_total(tile);
			const $card = $('<button class="ic-kpi-card" type="button"></button>')
				.addClass(tile.risk ? `ic-kpi-card--${tile.risk}` : "")
				.on("click", () => this._open_tile(tile))
				.appendTo($strip);

			$('<span class="ic-kpi-label"></span>').text(ic_label(tile.label)).appendTo($card);
			$('<span class="ic-kpi-value ic-num"></span>').text(ic_count_or_wait(count)).appendTo($card);
			const $meter = ic_meter($card, count, total);
			if ($meter && tile.risk) {
				$meter.addClass("ic-meter--risk");
				$meter.find(".ic-meter-share").attr("title", t("of_dated_records"));
			}
		});
	},

	// A tile moves exactly the ONE dimension its own count was measured across
	// and leaves every other filter where it stands, so the list it opens holds
	// the number that was on it. A status tile that also cleared the band would
	// land on more records than it counted.
	_open_tile(tile) {
		this.focus = null;
		if (tile.risk) this.risk = tile.risk;
		else this.status.val(tile.status);
		this.scope_of.triage = this.scope.val();
		this.view = "triage";
		this.refresh();
	},

	// --- band 2, the two chart cards ------------------------------------

	// H-09: the sketch's charts band (9:231) holds exactly two cards — a
	// flex:1 918px wide bar chart and a 300px fixed donut/stack card, gap 14,
	// summing to the band's 1232px inner width. A third card broke that
	// arithmetic; the project breakdown chart is dropped from this band, see
	// PHASE-R9-C-RESULT.md DROPPED for where its data still lives.
	_paint_charts($band) {
		this._render_overdue_chart($band);
		this._render_share_chart($band);
		this._render_dimension_chart($band);
	},

	// D-11: the twelve-month forward chart said "no expiry date in the next 12
	// months" directly under a red card counting hundreds of expiries, because
	// every record on this data expired years ago. The axis runs into the past
	// and the buckets are the ones an operator acts on.
	_overdue_series() {
		if (!this.expiry_counts) return null;
		const series = IC_OVERDUE_BUCKETS.map((bucket) => ({
			key: bucket.key,
			label: ic_label(bucket.label),
			value: cint(this.expiry_counts[bucket.key]),
		}));
		// F-20: a record with no iqama_expiration_date matches none of the
		// day-bound buckets above and used to vanish from the chart, so the
		// six bars under-summed the header by exactly the undated records.
		// _bucket_expiry() in ic_store.js already counts them into
		// expiry_counts.none; this is the row that draws them instead of
		// dropping them.
		series.push({
			key: "none",
			label: t("no_expiry"),
			value: cint(this.expiry_counts.none),
		});
		return series;
	},

	_render_overdue_chart($band) {
		const $card = $('<div class="ic-chart-card ic-chart-card--wide"></div>').appendTo($band);
		$('<h3 class="ic-chart-title"></h3>').text(t("chart_overdue")).appendTo($card);

		const series = this._overdue_series();
		if (!series) {
			$('<div class="ic-empty text-muted"></div>').text(t("loading")).appendTo($card);
			return;
		}
		if (!series.some((entry) => entry.value)) {
			$('<div class="ic-empty text-muted"></div>').text(t("chart_empty")).appendTo($card);
			return;
		}

		// Drawn as plain elements rather than through frappe.Chart: the design
		// fixes the plot height, which the chart library's own axes and padding
		// cannot be held to. Horizontal, because the bucket names are words.
		const total = this._expiry_total();
		const $plot = $('<div class="ic-hbars"></div>').appendTo($card);

		series.forEach((entry) => {
			const share = total ? Math.round((entry.value / total) * 100) : 0;
			const $row = $('<button class="ic-hbar" type="button"></button>')
				.attr("title", `${entry.label}  ·  ${entry.value}`)
				.on("click", () => this._open_bucket(entry.key))
				.appendTo($plot);
			$('<span class="ic-hbar-label"></span>').text(entry.label).appendTo($row);
			const $track = $('<span class="ic-hbar-track"></span>').appendTo($row);
			$('<span class="ic-hbar-fill"></span>')
				.addClass(`ic-hbar-fill--${entry.key}`)
				.css("inline-size", `${share}%`)
				.appendTo($track);
			const $value = $('<span class="ic-hbar-value ic-num"></span>').appendTo($row);
			$('<span class="ic-hbar-count"></span>').text(ic_count(entry.value)).appendTo($value);
			if (total) {
				$('<span class="ic-meter-share"></span>')
					.text(t("share_of", ic_count(share), ic_count(total)))
					.appendTo($value);
			}
		});
	},

	// A bar opens its OWN band, not the nearest chip's. The band key goes
	// straight into this.risk, which the query builder turns back into the same
	// two day bounds the bar was drawn from, so the list holds the number the
	// bar showed.
	_open_bucket(key) {
		this.focus = null;
		this.risk = key;
		this.scope_of.triage = this.scope.val();
		this.view = "triage";
		this.refresh();
	},

	// D-10: the donut drew four of nine statuses, summed 11,663 of 11,814 and
	// computed its percentages against that partial sum — and the five it left
	// out were exactly the ones needing a person. Every status the population
	// holds is drawn, one status holds more than half of it so the shape is a
	// stacked bar rather than a ring, and anything under IC_SHARE_FLOOR is
	// gathered into one slice that opens rather than being dropped.
	_share_slices() {
		const counts = this._status_counts();
		const total = this._population();
		if (!total) return null;

		const ranked = this._status_range()
			.filter((status) => cint(counts[status]))
			.map((status) => ({ key: status, label: ic_label(status), value: cint(counts[status]) }))
			.sort((a, b) => b.value - a.value);

		if (this.share_expanded) return ranked;

		const big = ranked.filter((slice) => slice.value / total >= IC_SHARE_FLOOR);
		const small = ranked.filter((slice) => slice.value / total < IC_SHARE_FLOOR);
		if (small.length < 2) return ranked;

		big.push({
			key: "other",
			label: t("other_statuses", ic_count(small.length)),
			value: small.reduce((sum, slice) => sum + slice.value, 0),
			members: small,
		});
		return big;
	},

	_render_share_chart($band) {
		const $card = $('<div class="ic-chart-card ic-chart-card--share"></div>').appendTo($band);
		const total = this._population();
		$('<h3 class="ic-chart-title"></h3>')
			.text(t("chart_status", ic_count_or_wait(total)))
			.appendTo($card);

		const slices = this._share_slices();
		if (!slices || !slices.length) {
			$('<div class="ic-empty text-muted"></div>').text(t("nothing_to_share")).appendTo($card);
			return;
		}

		const $stack = $('<div class="ic-stack"></div>')
			.attr("role", "img")
			.attr("aria-label", t("chart_status", ic_count(total)))
			.appendTo($card);

		slices.forEach((slice, index) => {
			$('<span class="ic-stack-part"></span>')
				.addClass(`ic-stack-part--${slice.key === "other" ? "other" : index + 1}`)
				.attr("title", `${slice.label}  ·  ${slice.value}`)
				.css("flex-grow", String(slice.value))
				.appendTo($stack);
		});

		const $list = $('<ul class="ic-share-list"></ul>').appendTo($card);
		slices.forEach((slice, index) => {
			const $row = $('<li class="ic-share-row"></li>').appendTo($list);
			$('<span class="ic-share-key"></span>')
				.addClass(`ic-share-key--${slice.key === "other" ? "other" : index + 1}`)
				.appendTo($row);

			const $text = $('<button class="ic-share-text" type="button"></button>')
				.attr("title", slice.members ? slice.members.map((one) => one.label).join("  ·  ") : slice.label)
				.on("click", () => this._open_slice(slice))
				.appendTo($row);
			$('<span class="ic-share-name"></span>').text(slice.label).appendTo($text);
			$('<span class="ic-share-count ic-num"></span>')
				.text(`${ic_count(slice.value)}  ·  ${ic_count(Math.round((slice.value / total) * 100))}%`)
				.appendTo($text);
		});
	},

	_dimension_slices(mode) {
		const series = this._dimension_series(mode);
		const total = this._dimension_total(mode);
		if (!series || !total || this.dim_expanded) return series;

		const big = series.filter((entry) => entry.value / total >= IC_SHARE_FLOOR);
		const small = series.filter((entry) => entry.value / total < IC_SHARE_FLOOR);
		if (small.length < 2) return series;

		big.push({
			key: "other",
			label: t("other_statuses", ic_count(small.length)),
			value: small.reduce((sum, entry) => sum + entry.value, 0),
			members: small,
		});
		return big;
	},

	_render_dimension_chart($band) {
		const mode = this._dimension_mode();
		const name = mode === "cost_center" ? t("f_cost_center") : t("f_department");
		const total = this._dimension_total(mode);
		const $card = $('<div class="ic-chart-card ic-chart-card--dim"></div>').appendTo($band);

		const $head = $('<div class="ic-dim-head"></div>').appendTo($card);
		$('<h3 class="ic-chart-title"></h3>')
			.text(t("chart_dimension", name, ic_count_or_wait(total)))
			.appendTo($head);

		const $modes = $('<div class="ic-dim-modes"></div>').appendTo($head);
		IC_PROJECT_MODES.forEach((entry) => {
			$('<button class="ic-dim-mode" type="button"></button>')
				.toggleClass("is-on", entry.key === mode)
				.text(t(entry.label_key))
				.on("click", () => {
					this.dim_mode = entry.key;
					this.dim_expanded = false;
					this._repaint(this.$charts, ($el) => this._paint_charts($el));
				})
				.appendTo($modes);
		});

		const slices = this._dimension_slices(mode);
		if (!slices) {
			$('<div class="ic-empty text-muted"></div>').text(t("loading")).appendTo($card);
			return;
		}
		if (!slices.length || !total) {
			$('<div class="ic-empty text-muted"></div>').text(t("nothing_to_share")).appendTo($card);
			return;
		}

		const $stack = $('<div class="ic-stack"></div>')
			.attr("role", "img")
			.attr("aria-label", t("chart_dimension", name, ic_count(total)))
			.appendTo($card);

		slices.forEach((slice, index) => {
			$('<span class="ic-stack-part"></span>')
				.addClass(`ic-stack-part--${slice.key === "other" ? "other" : (index % 9) + 1}`)
				.attr("title", `${slice.label}  ·  ${slice.value}`)
				.css("flex-grow", String(slice.value))
				.appendTo($stack);
		});

		const $list = $('<ul class="ic-share-list"></ul>').appendTo($card);
		slices.forEach((slice, index) => {
			const $row = $('<li class="ic-share-row"></li>').appendTo($list);
			$('<span class="ic-share-key"></span>')
				.addClass(`ic-share-key--${slice.key === "other" ? "other" : (index % 9) + 1}`)
				.appendTo($row);

			const $text = $('<button class="ic-share-text" type="button"></button>')
				.attr("title", slice.members ? slice.members.map((one) => one.label).join("  ·  ") : slice.label)
				.on("click", () => this._open_dimension(mode, slice))
				.appendTo($row);
			$('<span class="ic-share-name"></span>').text(slice.label).appendTo($text);
			$('<span class="ic-share-count ic-num"></span>')
				.text(`${ic_count(slice.value)}  ·  ${ic_count(Math.round((slice.value / total) * 100))}%`)
				.appendTo($text);
		});
	},

	_open_dimension(mode, slice) {
		if (slice.members) {
			this.dim_expanded = true;
			this._repaint(this.$charts, ($el) => this._paint_charts($el));
			return;
		}
		this.project_cascade = this.project_cascade || { open: false, mode: "", value: "" };
		this.project_cascade.mode = mode;
		this.project_cascade.value = slice.label;
		this.focus = null;
		this.scope_of.triage = this.scope.val();
		this.view = "triage";
		this.refresh();
	},

	_open_slice(slice) {
		if (slice.members) {
			this.share_expanded = true;
			this._repaint(this.$charts, ($el) => this._paint_charts($el));
			return;
		}
		this._open_tile({ status: slice.key });
	},

	// --- band 3, the table ----------------------------------------------

	// The one thing on this view drawn from the LOADED page rather than from a
	// count, because it is a list of records and not a number. Its heading says
	// how many of how many it is showing, so it never claims to be the whole
	// queue.
	_paint_today($band) {
		const $card = $('<div class="ic-today-card"></div>').appendTo($band);
		const rows = this._needs_today();

		const $head = $('<div class="ic-today-head"></div>').appendTo($card);
		$('<h3 class="ic-today-title"></h3>').text(t("needs_today")).appendTo($head);
		$('<span class="ic-today-count ic-num"></span>')
			.text(t("showing_of", ic_count(Math.min(rows.length, IC_TABLE_ROWS)), ic_count(rows.length)))
			.appendTo($head);
		$('<span class="ic-today-gap"></span>').appendTo($head);

		// The table is a slice of the loaded page — working statuses, seven days
		// or less — and no control on the page states that slice, so the link
		// says what it actually opens: the list this card was drawn from, at the
		// window the dashboard is standing in, with the two narrowings cleared.
		$('<button class="ic-today-all" type="button"></button>')
			.text(t("open_full_list"))
			.on("click", () => {
				this.focus = null;
				this.risk = "";
				this.status.val("");
				this.scope_of.triage = this.scope.val();
				this.view = "triage";
				this.refresh();
			})
			.appendTo($head);

		if (!rows.length) {
			this._empty_state($card, t("today_empty"));
			return;
		}

		const $rows = $('<div class="ic-today-rows"></div>').appendTo($card);
		rows.slice(0, IC_TABLE_ROWS).forEach((row) => this._render_today_row($rows, row));
	},

	// The design's row is five wireframe bars. They carry the four columns the
	// table held before: the name in the 150 slot, days left and the amount due
	// in the flexible detail slot, the status in the 80 pill and the row's own
	// affordance in the 64 chip.
	_render_today_row($rows, row) {
		const state = ic_expiry_state(row);
		const due = this._due_amount([row]);
		const name = ic_row_name(row);
		const status = ic_label(row.status || "");
		const $row = $('<div class="ic-today-row"></div>')
			.attr("data-row", row.name)
			.on("click", () => this._focus_row(row.name))
			.appendTo($rows);

		// D-19: an Arabic name gets its first name here, not two glyphs.
		$('<span class="ic-today-face"></span>')
			.toggleClass("ic-avatar--word", ic_is_arabic(name))
			.text(ic_initials(name))
			.appendTo($row);
		$('<span class="ic-today-name"></span>').attr("title", name).text(name).appendTo($row);

		const $detail = $('<span class="ic-today-detail"></span>').appendTo($row);
		// D-16: same source, same sign, same wording as the triage list badge.
		$('<span class="ic-today-days ic-num"></span>')
			.addClass(`ic-days--${ic_urgency(ic_days_left(row))}`)
			.attr("title", state.long)
			.text(state.short)
			.appendTo($detail);
		// D-17: a record whose fees were never calculated said "0.00 ر.س" here,
		// which the operator read as a real amount of nothing.
		$('<span class="ic-today-due ic-num"></span>')
			.toggleClass("ic-money-value--none", !ic_has_amount(due))
			.attr("title", t("due"))
			.text(ic_money_or_none(due))
			.appendTo($detail);

		$('<span class="ic-today-status indicator-pill"></span>')
			.addClass(`ic-pill--${ic_status_tone(row.status)}`)
			.attr("title", status)
			.text(status)
			.appendTo($row);

		$('<button class="ic-today-open" type="button"></button>')
			.text(t("open"))
			.on("click", (event) => {
				event.stopPropagation();
				this._focus_row(row.name);
			})
			.appendTo($row);
	},
});

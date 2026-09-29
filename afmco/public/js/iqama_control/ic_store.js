// Copyright (c) 2026, AFMCO and contributors

// T1 (R12-C): the day window a duplicate pairing is measured against —
// _duplicate_names()/_within_duplicate_window() below, never IC_ARCHIVE_DAYS
// (ic_config.js), which is the unrelated general list-scope window.
const IC_DUPLICATE_WINDOW_DAYS = 60;

// B15: IC_ROW_LIMIT (ic_config.js) is the page SIZE the server answers per
// request, never the fetch TOTAL — a population past one page (623 rows
// against a 500-row page, observed live) was silently cut to the page size,
// with nothing on screen to say so. _fetch_rows() below walks pages until one
// comes back short (the real end of the set) or IC_ROW_PAGES pages have been
// asked for, so a scope this wide still costs a bounded number of round trips
// rather than an unbounded one.
const IC_ROW_PAGES = 6;

Object.assign(IqamaControl.prototype, {
	// ── THE ONE QUERY BUILDER ────────────────────────────────────────────
	//
	// D-09: every list on this page and every number that heads one is built
	// from here, so a single concept can never show two numbers. `except`
	// names the ONE dimension the caller is measuring ACROSS — a per-status
	// tally drops the operator's status pick and keeps everything else, a
	// per-band expiry tally drops the risk band, the missing-fees chip drops
	// the fee narrowing.
	//
	// Two writers on one filter key is the defect class this replaces. Scope
	// and status both wrote `filters.status`, and the tally then deleted the
	// key outright, so the header counted records the list had filtered away.
	// Each dimension is resolved to ONE key here instead.
	//
	// note.3: the age line is added first and every caller carries it, because a
	// caller that forgets it produces a number nothing else on the page agrees
	// with. The scope resolves to this ONE key: it writes no owner and no
	// status, so it cannot collide with the two dimensions that have their own
	// writers below.
	_filters(except) {
		const filters = {};

		const floor = ic_scope_floor(this.scope.val());
		if (floor) filters[IC_AGE_FIELD] = [">=", floor];

		let statuses = this._status_range();
		const status = this.status.val();
		// A pick the range no longer holds resolves to `status IN ()`, which
		// empties every list and every count on the page at once. The range is
		// what the page can show, so a pick outside it is not a narrowing.
		if (status && except !== "status" && statuses.includes(status)) statuses = [status];
		if (statuses.length !== IC_STATUSES.length) filters.status = ["in", statuses];

		// F-20: "none" is not a day-bound window — ic_band("none") finds no
		// entry in IC_BANDS, so a plain bounds lookup would drop the expiry
		// filter entirely and open every row instead of only the ones
		// carrying no date. It is intersected with the same fields the rest
		// of this builder narrows on, exactly like every other dimension.
		if (except !== "risk" && this.risk === "none") {
			filters.iqama_expiration_date = ["is", "not set"];
		} else {
			const bounds = this._expiry_bounds(except);
			if (bounds.from && bounds.to) {
				filters.iqama_expiration_date = ["between", [bounds.from, bounds.to]];
			} else if (bounds.to) {
				filters.iqama_expiration_date = ["<=", bounds.to];
			} else if (bounds.from) {
				filters.iqama_expiration_date = [">=", bounds.from];
			}
		}

		// D-17: a record whose two fees are both unwritten cannot be paid. The
		// chip is a real query, not a pass over the loaded page, so the number
		// on it is the number pressing it returns.
		if (except !== "fees" && this.missing_fees) {
			filters.work_permit_fee = ["<=", 0];
			filters.iqama_renewal_amount = ["<=", 0];
		}

		const corporation = this.corporation.get_value();
		if (corporation) filters.corporation = corporation;

		// R10-A: the project filter is ONE cascade, not two stacked pickers —
		// department and cost centre are ALTERNATE paths (IC_PROJECT_MODES), so
		// this writes AT MOST one of filters.department / filters.cost_center,
		// never both. this.project_cascade is the one state object the trigger
		// pill, the mode buttons, the value list and this builder all read; a
		// mode with no value chosen yet narrows nothing, which is what lets
		// _count_by_project()/_count_by_cost_center() show the FULL present-
		// value list (scoped by every OTHER filter) before a value is picked.
		const cascade = this.project_cascade || { mode: "", value: "" };
		if (cascade.mode === "department" && except !== "project") {
			if (cascade.value && this.project_map && this.project_map[cascade.value]) {
				filters.department = ["in", this.project_map[cascade.value]];
			}
		} else if (cascade.mode === "cost_center" && except !== "cost_center") {
			if (cascade.value && this.cost_center_map && this.cost_center_map[cascade.value]) {
				filters.cost_center = ["in", this.cost_center_map[cascade.value]];
			}
		}

		const employee = this.employee.get_value();
		if (employee) filters.employee = employee;

		if (this.only_with_sadad.get_value()) filters.sadad_invoice = ["is", "set"];

		return filters;
	},

	// The statuses the page can hold. The rail lists exactly these, so the
	// rail's rows sum to its "All statuses" row and clicking any one of them
	// returns the number the row showed. ONE writer: the settled question is
	// answered here and the scope never touches this dimension.
	_status_range() {
		let range = IC_STATUSES.slice();

		// The settled statuses are narrowed out HERE and nowhere else. Writing
		// filters.status from the field itself gave the status dimension two
		// writers and one column, and the rail then described a population the
		// list did not hold.
		const settled = this.include_settled ? this.include_settled.get_value() : 0;
		if (!settled) {
			range = range.filter((status) => !IC_SETTLED.includes(status));
		}

		return range;
	},

	// ITEM 4: a committed employee/iqama-number search has to find its record
	// no matter what the operator's OTHER filters currently hide it behind —
	// the 60-day scope window, a status pick, "include settled", a
	// department/corporation/project pick, a risk band or the missing-fees
	// chip. Every one of those is reset to its open state before the employee
	// filter itself is written, so the search still resolves through the SAME
	// single _filters() builder every other control on the page uses — this
	// opens no second query path, it only clears the other dimensions of the
	// one that exists.
	// K-20: the search used to widen these nine dimensions with no snapshot
	// anywhere, so clearing the search restored nothing and a stray blur could
	// park the operator permanently off IC_SCOPE_DEFAULT. The snapshot is taken
	// ONCE per search episode — a second Enter/blur while a snapshot is already
	// open must not overwrite it with the ALREADY-widened state, or restore
	// would just restore the widened state to itself. `this._search_widened`
	// names, against that ORIGINAL snapshot, exactly which keys this call
	// actually moved, so a caller can state on screen what was widened without
	// re-deriving it.
	_widen_for_search() {
		if (!this._search_snapshot) {
			this._search_snapshot = {
				scope: this.scope.val(),
				scope_of_view: this.scope_of[this.view],
				status: this.status.val(),
				include_settled: this.include_settled ? this.include_settled.get_value() : 0,
				corporation: this.corporation ? this.corporation.get_value() : "",
				project_mode: this.project_cascade ? this.project_cascade.mode : "",
				project_value: this.project_cascade ? this.project_cascade.value : "",
				risk: this.risk,
				missing_fees: this.missing_fees,
				expiry_to: this.expiry_to ? this.expiry_to.get_value() : "",
				only_with_sadad: this.only_with_sadad ? this.only_with_sadad.get_value() : 0,
			};
		}

		this.scope.val("all");
		this.scope_of[this.view] = "all";
		this.status.val("");
		if (this.include_settled) this.include_settled.set_value(1);
		if (this.corporation) this.corporation.set_value("");
		// R10-A: the project filter is now the one cascade state object; a
		// search that widens every other dimension resets it the same way its
		// own clear-filter control does, WITHOUT touching include_settled —
		// that field is set explicitly two lines above this block, on purpose.
		if (this.project_cascade) {
			this.project_cascade.mode = "";
			this.project_cascade.value = "";
			this.project_cascade.open = false;
			if (this._repaint_project_cascade) this._repaint_project_cascade();
		}
		this.risk = "";
		this.missing_fees = false;
		if (this.expiry_to) this.expiry_to.set_value("");
		if (this.only_with_sadad) this.only_with_sadad.set_value(0);

		const base = this._search_snapshot;
		const widened = [];
		if (base.scope !== "all") widened.push("scope");
		if (base.status) widened.push("status");
		if (!base.include_settled) widened.push("include_settled");
		if (base.corporation) widened.push("corporation");
		if (base.project_mode) widened.push("project");
		if (base.risk) widened.push("risk");
		if (base.missing_fees) widened.push("missing_fees");
		if (base.expiry_to) widened.push("expiry_to");
		if (base.only_with_sadad) widened.push("only_with_sadad");
		this._search_widened = widened;
	},

	// The restore half of K-20: put back exactly the snapshot _widen_for_search
	// took, then drop both the snapshot and the widened list so the NEXT search
	// takes a fresh snapshot instead of restoring an already-restored state.
	// Returns false, and touches nothing, when there is no snapshot to restore
	// — a caller (the restore control) reads that to disable itself. Does not
	// call refresh() and does not touch the search term itself (this.employee)
	// — the caller decides when to refetch and the search input is a separate
	// escape (clear-search), not this method's job.
	_restore_filters() {
		const snap = this._search_snapshot;
		if (!snap) return false;

		this.scope.val(snap.scope);
		this.scope_of[this.view] = snap.scope_of_view;
		this.status.val(snap.status);
		if (this.include_settled) this.include_settled.set_value(snap.include_settled);
		if (this.corporation) this.corporation.set_value(snap.corporation);
		if (this.project_cascade) {
			this.project_cascade.mode = snap.project_mode;
			this.project_cascade.value = snap.project_value;
			this.project_cascade.open = false;
			if (this._repaint_project_cascade) this._repaint_project_cascade();
		}
		this.risk = snap.risk;
		this.missing_fees = snap.missing_fees;
		if (this.expiry_to) this.expiry_to.set_value(snap.expiry_to);
		if (this.only_with_sadad) this.only_with_sadad.set_value(snap.only_with_sadad);

		this._search_snapshot = null;
		this._search_widened = [];
		return true;
	},

	// The expiry dimension has two writers — the risk band and the "expiring
	// before" date — and one column to write to, so they are intersected into
	// one condition instead of overwriting each other. The band bounds are the
	// same day counts IC_RISK tests, so a chip's server count and the list it
	// opens are the same set of records.
	_expiry_bounds(except) {
		const today = frappe.datetime.get_today();
		const shift = (days) => String(frappe.datetime.add_days(today, days)).slice(0, 10);
		let from = "";
		let to = "";

		const band = except !== "risk" && this.risk ? ic_band(this.risk) : null;
		if (band) {
			if (band.from !== undefined) from = shift(band.from);
			if (band.to !== undefined) to = shift(band.to);
		}

		const expiry_to = this.expiry_to.get_value();
		if (expiry_to && (!to || String(expiry_to) < to)) to = String(expiry_to);

		return { from: from, to: to };
	},

	// B15: one page, walked until it comes back short (the real end of the
	// set) or IC_ROW_PAGES pages have been asked for. `rows_truncated` is set
	// true only when the walk stopped at the page cap with a still-full last
	// page, i.e. the population may hold more than IC_ROW_LIMIT*IC_ROW_PAGES
	// rows past the current filters — the honest signal a hard single-page
	// cap could not give, since a full first page and an exactly-500-row
	// population look identical from one request alone.
	_fetch_rows(filters, start, gathered) {
		start = start || 0;
		gathered = gathered || [];
		return frappe.db
			.get_list(IC_DOCTYPE, {
				fields: IC_FIELDS,
				filters: filters,
				order_by: "iqama_expiration_date asc, modified desc",
				limit: IC_ROW_LIMIT,
				limit_start: start,
			})
			.then((rows) => {
				rows = rows || [];
				const all = gathered.concat(rows);
				const page_full = rows.length === IC_ROW_LIMIT;
				const pages_done = all.length / IC_ROW_LIMIT;
				if (page_full && pages_done < IC_ROW_PAGES) {
					return this._fetch_rows(filters, start + IC_ROW_LIMIT, all);
				}
				this.rows_truncated = page_full;
				return all;
			});
	},

	// One round trip per dimension, all four launched together and rendered
	// once. Three separate render() calls used to run per refresh — the list,
	// then the tally, then the bands — which is a third of what owner note.6
	// is describing.
	refresh() {
		const newest = ic_newest_only(this, "_gen");
		const filters = this._filters();

		this.loading = true;
		this._paint_loading();

		Promise.all([
			this._fetch_rows(filters),
			this._count_by_status(),
			this._count_by_expiry(),
			this._count_missing_fees(),
			this._count_by_project(),
			this._count_by_cost_center(),
		])
			.then((answers) => {
				if (!newest()) return;
				this.loading = false;
				this.rows = answers[0] || [];
				this.tally = answers[1];
				this.expiry_counts = answers[2];
				this.missing_count = answers[3];
				// R9-E: this.project_counts (the raw tally _count_by_project()
				// also returns) is dropped here — grepped every file in this
				// round's read scope, nothing reads it any more since the
				// dashboard rebuild dropped its project chart. _count_by_project()
				// ITSELF stays in the Promise.all above: PHASE-R9-C-RESULT.md's
				// hand-off asked for the whole call to be cut, but that call's
				// .then() also sets this.project_map/this.project_options
				// (ic_store.js _count_by_project, below), which the very next
				// lines here use to populate the project filter's own dropdown
				// — cutting the call would have emptied that dropdown on every
				// view, not just removed dead work.
				// R10-A: the department-mode tally used to be computed and thrown
				// away (R9-E's note above) because nothing read it once the
				// dashboard's project chart was cut. The project filter's own
				// value list is that reader now — PRESENT-VALUES gate needs a
				// count beside every value it lists, the same way cost centre
				// already carried one.
				this.project_counts = answers[4];
				this.cost_center_counts = answers[5];
				if (this._repaint_project_cascade) this._repaint_project_cascade();
				// K-17: every write ends in refresh() (ic_actions.js _write_action),
				// and this used to unconditionally reset the drawn page back to 50 —
				// deciding a record past row 50 cost a hunt back to it on every
				// single action. Keep whatever page size the operator already grew
				// to; only the very first load, which has nothing to keep, needs the
				// default.
				this.shown = this.shown || IC_PAGE_ROWS;
				this.duplicates = null;

				const names = new Set(this.rows.map((row) => row.name));
				this.selected.forEach((name) => {
					if (!names.has(name)) this.selected.delete(name);
				});
				if (this.focus && !names.has(this.focus)) this.focus = null;

				// owner note.6: a fetch replaces the DATA. The view's shell,
				// the filter bar and the action bar are built once and stay,
				// and _repaint_data() builds the shell only when the view the
				// operator is looking at is not the one on screen.
				this._repaint_data();
				this._paint_truncation();
				this._load_nitaqat();
			})
			.catch((error) => {
				if (!newest()) return;
				this.loading = false;
				// B2/B4: this used to hand `response` straight to ic_error_text()
				// with nothing logged, so a client-side exception thrown while
				// painting a 200-OK answer (never a server response at all) fell
				// through every branch ic_error_text() checks and always landed
				// on the "check your permissions" fallback — false on a JS
				// error, and invisible, because nothing here ever reached the
				// console. The raw value is logged first, and a real Error's
				// own message is preferred over the frappe-response guess.
				console.error("iqama_control refresh failed:", error);
				const detail =
					(error instanceof Error && error.message) ||
					ic_error_text(error, t("load_failed_reason"));
				this._render_error(detail);
			});
	},

	// A count that fails answers null rather than taking the board down with
	// it. Every renderer prints an em dash for a null, so a number the page
	// could not obtain is never mistaken for a zero.
	_count_by_status() {
		return frappe.db
			.get_list(IC_DOCTYPE, {
				fields: ["status", { COUNT: "name", as: "count" }],
				filters: this._filters("status"),
				group_by: "status",
				limit: 0,
			})
			.then((rows) => {
				const tally = {};
				(rows || []).forEach((row) => (tally[row.status] = cint(row.count)));
				return tally;
			})
			.catch((error) => {
				console.error("iqama_control _count_by_status failed:", error);
				return null;
			});
	},

	// One grouped query answers every expiry band the page draws: the four
	// risk chips, the overdue chart and the "Already expired" tile. Grouping
	// on the date column keeps it to a single round trip and the counts exact,
	// where a pass over the loaded page could only ever see the first 500.
	_count_by_expiry() {
		return frappe.db
			.get_list(IC_DOCTYPE, {
				fields: ["iqama_expiration_date", { COUNT: "name", as: "count" }],
				filters: this._filters("risk"),
				group_by: "iqama_expiration_date",
				limit: 0,
			})
			.then((rows) => this._bucket_expiry(rows || []))
			.catch((error) => {
				console.error("iqama_control _count_by_expiry failed:", error);
				return null;
			});
	},

	_bucket_expiry(rows) {
		const today = frappe.datetime.get_today();
		const counts = { none: 0 };
		IC_RISK.forEach((segment) => (counts[segment.key] = 0));
		IC_OVERDUE_BUCKETS.forEach((bucket) => (counts[bucket.key] = 0));

		rows.forEach((row) => {
			const count = cint(row.count);
			if (!row.iqama_expiration_date) {
				counts.none += count;
				return;
			}
			const days = cint(frappe.datetime.get_day_diff(row.iqama_expiration_date, today));
			const risk = ic_band_of(IC_RISK, days);
			const bucket = ic_band_of(IC_OVERDUE_BUCKETS, days);
			if (risk) counts[risk.key] += count;
			// K-34/regression: IC_OVERDUE_BUCKETS' "later" entry was renamed to
			// key "clear" ON PURPOSE so it resolves to the SAME IC_RISK "clear"
			// object everywhere ic_band(key) is called (ic_config.js comment on
			// IC_OVERDUE_BUCKETS). One shared key means one slot in `counts`; a
			// row past IC_SOON_DAYS therefore has risk.key === bucket.key === "clear"
			// and must add to that slot ONCE, not twice. Every other pairing
			// (expired/critical/soon vs over_year/half_year/quarter/recent/due_soon)
			// keys two genuinely different chips, so both still add independently.
			if (bucket && (!risk || bucket.key !== risk.key)) counts[bucket.key] += count;
		});

		return counts;
	},

	// F-14: one grouped query answers both the project dimension's chart and
	// its filter list. It groups on the real `department` column — the only
	// column ic_project_label() actually reads on this population — and folds
	// the raw values into their derived label here, so the rail-style chart
	// and the filter dropdown are built from the SAME distinct set the server
	// holds, not from whatever page of rows happened to load.
	_count_by_project() {
		return frappe.db
			.get_list(IC_DOCTYPE, {
				fields: ["department", { COUNT: "name", as: "count" }],
				filters: this._filters("project"),
				group_by: "department",
				limit: 0,
			})
			.then((rows) => {
				const tally = {};
				const map = {};
				(rows || []).forEach((row) => {
					const label = ic_project_label(row);
					if (!label) return;
					tally[label] = (tally[label] || 0) + cint(row.count);
					if (!map[label]) map[label] = [];
					if (row.department) map[label].push(row.department);
				});
				this.project_map = map;
				this.project_options = Object.keys(map).sort();
				return tally;
			})
			.catch((error) => {
				console.error("iqama_control _count_by_project failed:", error);
				return null;
			});
	},

	// H-06: the second level under a project/department pick. Grouped the same
	// way _count_by_project() is — one query answers both the option list and
	// its counts — and scoped by `_filters("cost_center")`, so choosing a
	// department first narrows the cost centres this list offers.
	_count_by_cost_center() {
		return frappe.db
			.get_list(IC_DOCTYPE, {
				fields: ["cost_center", { COUNT: "name", as: "count" }],
				filters: this._filters("cost_center"),
				group_by: "cost_center",
				limit: 0,
			})
			.then((rows) => {
				const tally = {};
				const map = {};
				(rows || []).forEach((row) => {
					if (!row.cost_center) return;
					const label = ic_project_label(row.cost_center);
					if (!label) return;
					tally[label] = (tally[label] || 0) + cint(row.count);
					if (!map[label]) map[label] = [];
					map[label].push(row.cost_center);
				});
				this.cost_center_map = map;
				this.cost_center_options = Object.keys(map).sort();
				return tally;
			})
			.catch((error) => {
				console.error("iqama_control _count_by_cost_center failed:", error);
				return null;
			});
	},

	_count_missing_fees() {
		const filters = Object.assign({}, this._filters("fees"), {
			work_permit_fee: ["<=", 0],
			iqama_renewal_amount: ["<=", 0],
		});
		return frappe.db
			.count(IC_DOCTYPE, { filters: filters })
			.then((count) => cint(count))
			.catch((error) => {
				console.error("iqama_control _count_missing_fees failed:", error);
				return null;
			});
	},

	// The error box replaces the view, so the regions the repaint layer holds
	// references to are gone. Forgetting to say so would leave a later repaint
	// painting into an orphan node that is no longer in the document.
	_render_error(detail) {
		this._park();
		this._built = null;
		this.$view.removeClass("is-loading").empty();
		const $box = $('<div class="ic-error" role="alert"></div>').appendTo(this.$view);
		$('<div class="ic-error-title"></div>').text(t("load_failed_title")).appendTo($box);
		$('<div class="ic-error-detail"></div>').text(detail).appendTo($box);
		// B3: a second click here used to fire a SECOND, later-ticketed
		// refresh() while the first was still in flight; ic_newest_only keeps
		// only the last-fired ticket (ic_utils.js:253-257), so the first
		// click's answer — success or failure — was discarded on arrival no
		// matter what it said, which is what made retry read as unreliable
		// rather than as a request that was simply overtaken. Disabling the
		// button on the click that already fired closes that window; refresh()
		// always ends by either replacing this panel or clearing it, so there
		// is nothing left standing to re-enable it for.
		$('<button class="btn btn-sm btn-default"></button>')
			.text(t("retry"))
			.on("click", (event) => {
				$(event.currentTarget).prop("disabled", true);
				this.refresh();
			})
			.appendTo($box);
	},

	// owner note.6: a fetch must not blank the board. The view keeps standing
	// and wears a class while the answer is in flight; only the very first
	// load, which has nothing to keep, draws a line of its own.
	_paint_loading() {
		this.$view.toggleClass("is-loading", Boolean(this.loading));
		if (!this.loading) return;
		// B3/B5: an error panel left standing used to count as "real content
		// to preserve" here, the same guard owner note.6 writes for real data.
		// A refresh fired from that state (the retry click, or any filter
		// change made while the panel was still up) then painted no loading
		// feedback at all, leaving the OLD error and its still-clickable retry
		// button on screen for the whole round trip — which is what let a
		// second, overlapping click through in the first place (see
		// _render_error above). Treating the error box as empty here means
		// every refresh, retry included, visibly starts over.
		if (this.$view.children().length && !this.$view.find(".ic-error").length) return;
		this.$view.empty();
		$('<div class="ic-empty text-muted"></div>').text(t("loading")).appendTo(this.$view);
	},

	// B15: rows_truncated (set by _fetch_rows above) had no renderer, so a
	// population past the page ceiling was cut exactly as silently as the
	// single-page cap it replaced. Called after every _repaint_data() in this
	// file so the notice never drifts from what was just drawn.
	_paint_truncation() {
		this.$view.find("[data-ic-row-cap]").remove();
		if (!this.rows_truncated) return;
		$('<div class="ic-truncated" data-ic-row-cap="1"></div>')
			.text(t("rows_truncated", IC_ROW_LIMIT * IC_ROW_PAGES))
			.appendTo(this.$view);
	},

	_load_nitaqat() {
		if (!IC_NITAQAT_FIELD) return;
		const corporations = Array.from(
			new Set(this.rows.map((row) => row.corporation).filter(Boolean))
		);
		if (!corporations.length) return;

		const newest = ic_newest_only(this, "_bandgen");
		frappe.db
			.get_list("Corporation", {
				fields: ["name", IC_NITAQAT_FIELD],
				filters: { name: ["in", corporations] },
				limit: IC_ROW_LIMIT,
			})
			.then((rows) => {
				if (!newest()) return;
				const map = {};
				(rows || []).forEach((row) => {
					if (row[IC_NITAQAT_FIELD]) map[row.name] = row[IC_NITAQAT_FIELD];
				});
				this.nitaqat = map;
				this._repaint_data();
				this._paint_truncation();
			})
			.catch((error) => console.error("iqama_control _load_nitaqat failed:", error));
	},

	_load_history(row) {
		if (this.history[row.name]) return Promise.resolve(this.history[row.name]);

		const newest = ic_newest_only(this, "_histgen");
		return new Promise((resolve) => {
			frappe.call({
				method: "frappe.desk.form.load.get_docinfo",
				args: { doctype: IC_DOCTYPE, name: row.name },
				callback: (response) => {
					if (!newest()) return resolve([]);
					const entries = this._history_entries(row, (response && response.docinfo) || {});
					this.history[row.name] = entries;
					resolve(entries);
				},
				error: (error) => {
					console.error("iqama_control _load_history failed:", error);
					this.history[row.name] = [];
					resolve([]);
				},
			});
		});
	},

	// D-18: nine rows of one user's email is not a history. The emails are
	// resolved to User full names once and cached on the board, and the email
	// itself moves to the title attribute. A name already asked for is never
	// asked for twice, including one whose lookup failed — the entry stays and
	// the renderer falls back to the email.
	_load_users(emails) {
		if (!this.users) this.users = {};
		const wanted = Array.from(new Set(emails.filter(Boolean))).filter(
			(email) => this.users[email] === undefined
		);
		if (!wanted.length) return Promise.resolve(this.users);

		wanted.forEach((email) => (this.users[email] = null));
		return frappe.db
			.get_list("User", {
				filters: [["name", "in", wanted]],
				fields: ["name", "full_name", "user_image"],
				limit: 0,
			})
			.then((rows) => {
				(rows || []).forEach((entry) => (this.users[entry.name] = entry));
				return this.users;
			})
			.catch((error) => {
				console.error("iqama_control _load_users failed:", error);
				return this.users;
			});
	},

	// ITEM 1(a): the avatar's real photo, fetched the way Frappe itself serves
	// one. Employee.image is an Attach Image field (apps/erpnext/erpnext/setup/
	// doctype/employee/employee.json:186-191); frappe's upload handler writes
	// the served URL — public "/files/..." or private "/private/files/..." —
	// straight into that field, the SAME string the File doctype's own
	// file_url carries (apps/frappe/frappe/core/doctype/file/file.py). Reading
	// it back is asking the server, never building a path from the employee id
	// the way "/files/<employee>.jpg" would, and it stays correct for a
	// private file, which that string-built shape is not.
	//
	// Batched exactly like _load_users() above: every employee id on the
	// rendered page is asked for in ONE request, never one request per row,
	// and an id already answered (including "no photo", cached as "") is
	// never asked for twice.
	_load_employee_photos(rows) {
		if (!this.employee_photos) this.employee_photos = {};
		const wanted = Array.from(new Set(rows.map((row) => row.employee).filter(Boolean))).filter(
			(employee) => this.employee_photos[employee] === undefined
		);
		if (!wanted.length) return Promise.resolve(this.employee_photos);

		wanted.forEach((employee) => (this.employee_photos[employee] = null));
		const newest = ic_newest_only(this, "_photogen");
		return frappe.db
			.get_list("Employee", {
				filters: [["name", "in", wanted]],
				fields: ["name", "image"],
				limit: 0,
			})
			.then((answers) => {
				if (!newest()) return this.employee_photos;
				wanted.forEach((employee) => (this.employee_photos[employee] = ""));
				(answers || []).forEach((entry) => {
					this.employee_photos[entry.name] = entry.image || "";
				});
				this._repaint_data();
				this._paint_truncation();
				return this.employee_photos;
			})
			.catch((error) => {
				console.error("iqama_control _load_employee_photos failed:", error);
				return this.employee_photos;
			});
	},

	// The URL _avatar() renders, or "" — no photo yet answered, none on the
	// record, or one that 404s and was cleared by _photo_failed() below. Every
	// caller falls back to ic_first_name() on "", so a broken image never
	// shows a broken-image icon.
	_employee_photo(employee) {
		return (this.employee_photos && this.employee_photos[employee]) || "";
	},

	// A photo URL that 404s is cleared here and the row repainted, so the
	// fallback is the same first-name text a record with no photo at all
	// shows — never a broken image icon left standing.
	_photo_failed(employee) {
		if (!this.employee_photos || !employee) return;
		if (!this.employee_photos[employee]) return;
		this.employee_photos[employee] = "";
		this._repaint_data();
		this._paint_truncation();
	},

	_user_of(email) {
		return (this.users && this.users[email]) || null;
	},

	_user_name(email) {
		const user = this._user_of(email);
		return (user && user.full_name) || email || "";
	},

	_history_entries(row, docinfo) {
		const entries = [];

		(docinfo.versions || []).forEach((version) => {
			let data = {};
			try {
				data = JSON.parse(version.data || "{}");
			} catch (error) {
				console.warn("iqama_control version data unparsable:", error);
				data = {};
			}
			(data.changed || []).forEach((change) => {
				const fieldname = change[0];
				if (!IC_FIELD_LABELS[fieldname]) return;
				entries.push({
					when: version.creation,
					who: version.owner,
					label: ic_label(IC_FIELD_LABELS[fieldname]),
					fieldname: fieldname,
					from: change[1],
					to: change[2],
				});
			});
		});

		(docinfo.comments || []).forEach((comment) => {
			entries.push({
				when: comment.creation,
				who: comment.owner,
				label: t("comment"),
				to: strip_html(comment.content || ""),
			});
		});

		entries.push({
			when: row.creation,
			who: row.owner,
			label: t("created"),
			to: row.name,
		});

		return entries.sort((a, b) => String(b.when).localeCompare(String(a.when)));
	},

	_is_settled(row) {
		return IC_SETTLED.includes(row.status);
	},

	_is_pickable(row) {
		return Boolean(row) && !this._is_settled(row);
	},

	// G-04: a settled record (IC_SETTLED, read above) is closed work, so no
	// later-added condition can retroactively call it blocked. The employee
	// leaving AFTER a Renewed record was settled, or a stale issue flag, both
	// used to print "blocked" on a record with nothing left to act on.
	// Settlement is asked FIRST and short-circuits every other reason.
	_is_blocked(row) {
		if (this._is_settled(row)) return false;
		return Boolean(
			cint(row.iqama_renewal_issue) ||
				row.status === IC_BLOCKED_STATUS ||
				!IC_ALLOWED_EMPLOYEE_STATUS.includes(row.custom_employee_status)
		);
	},

	// A row this operator can still move: writable by them, and standing at a
	// status that is still being worked. It is a status test, never a scope.
	_is_working(row) {
		return this.can_write && IC_WORKING_STATES.includes(row.status);
	},

	// DATA-01/T1: two records for the same employee only read as a duplicate
	// when their iqama_expiration_date values fall within
	// IC_DUPLICATE_WINDOW_DAYS of each other — the same field
	// _sibling_records() below already keys its own duplicate-payment warning
	// on, so the on-screen marker and that warning agree on what "duplicate"
	// means. Two dated records outside the window, or a row missing the date
	// entirely, are never paired. The DocType carries no iqama number — its
	// forty fields hold employee, file_no and cost_center and nothing else
	// that identifies a person — so the employee link is still the other half
	// of the pairing.
	_duplicate_names() {
		const by_employee = {};
		this.rows.forEach((row) => {
			if (!row.employee) return;
			(by_employee[row.employee] = by_employee[row.employee] || []).push(row);
		});

		const flagged = {};
		Object.keys(by_employee).forEach((employee) => {
			const rows = by_employee[employee];
			const paired = rows.some((row, index) =>
				rows.some(
					(other, other_index) =>
						index !== other_index && this._within_duplicate_window(row, other)
				)
			);
			if (paired) flagged[employee] = true;
		});
		return flagged;
	},

	_within_duplicate_window(a, b) {
		if (!a.iqama_expiration_date || !b.iqama_expiration_date) return false;
		const days = Math.abs(
			cint(frappe.datetime.get_day_diff(a.iqama_expiration_date, b.iqama_expiration_date))
		);
		return days <= IC_DUPLICATE_WINDOW_DAYS;
	},

	_is_duplicate(row) {
		if (!this.duplicates) this.duplicates = this._duplicate_names();
		return Boolean(row.employee) && Boolean(this.duplicates[row.employee]);
	},

	// K-07: an open sibling — another OPEN record for the SAME employee at the
	// SAME iqama_expiration_date — is invisible to _is_duplicate() above,
	// because that test is keyed on the employee alone and only looks at rows
	// already loaded on this page. The daily script that creates these records
	// opens a new one only when none exists within 60 days, so a real sibling
	// is ALWAYS at least that old and sits outside the page's default scope —
	// a loaded-rows check can never see it. This is therefore a live,
	// scope-ignoring query straight to the server, never through _filters():
	// keyed on the employee AND the expiration date TOGETHER (never the
	// employee alone — 1269 of 1456 multi-open employees hold all-distinct
	// expiry dates, so an employee-wide guard would block 1062 legitimate
	// payments), restricted to non-settled statuses (a Renewed/Rejected
	// sibling is closed work, not a duplicate-payment risk), and excluding the
	// row itself. It answers a WARNING for the payment confirm face — the
	// caller decides whether to proceed; this never skips or blocks a row.
	_sibling_records(row) {
		if (!row || !row.employee || !row.iqama_expiration_date) return Promise.resolve([]);
		return frappe.db
			.get_list(IC_DOCTYPE, {
				fields: ["name", "status", "pr_status", "custom_pr_reference", "custom_pr_reference_2"],
				filters: {
					employee: row.employee,
					iqama_expiration_date: row.iqama_expiration_date,
					name: ["!=", row.name],
					status: ["not in", IC_SETTLED],
				},
				limit: IC_ROW_LIMIT,
			})
			.catch((error) => {
				console.error("iqama_control _sibling_records failed:", error);
				return [];
			});
	},

	// The server already applied every filter this page carries, including the
	// risk band and the missing-fees narrowing, so the loaded rows ARE the
	// list. Nothing is filtered a second time on the client, which is what let
	// a chip count and the list under it disagree.
	_visible_rows() {
		return this.rows;
	},

	_by_expiry(rows) {
		return rows.slice().sort((a, b) => ic_days_left(a) - ic_days_left(b));
	},

	// F-14: project has no column to order a query by, so both orders are
	// taken over the rows already fetched, same as the expiry order always
	// was. The default stays expiry; picking project only changes how the
	// loaded page is arranged, never what was fetched.
	_sorted_rows(rows) {
		if (this.sort_by !== "project") return this._by_expiry(rows);
		return rows.slice().sort((a, b) => {
			const cmp = String(ic_project_label(a)).localeCompare(String(ic_project_label(b)));
			return cmp !== 0 ? cmp : ic_days_left(a) - ic_days_left(b);
		});
	},

	// D-05: 500 rows is 8,091 nodes. The list draws a page at a time and grows
	// by an explicit press, so the first paint is one fiftieth of that.
	_page_rows(rows) {
		return rows.slice(0, this.shown || IC_PAGE_ROWS);
	},

	_due_amount(rows) {
		return rows.reduce(
			(sum, row) => sum + flt(row.work_permit_fee) + flt(row.iqama_renewal_amount),
			0
		);
	},

	// K-13: the batch row, the batch selection heading and the payment confirm
	// face all authorise the SAME request, so they must sum the SAME single
	// figure — one payment type's own amount_field — never _due_amount() above,
	// which sums BOTH fee fields and would print roughly double on any row
	// carrying both. `payment_type` is one of IC_PAYMENT_TYPES' own keys, the
	// same ones ic_actions.js's _create_pr/_skip_reason already resolve
	// `config.amount_field` from, so this can never drift from the figure the
	// confirm face states.
	_type_amount(rows, payment_type) {
		const config = IC_PAYMENT_TYPES[payment_type];
		if (!config) return 0;
		return (rows || []).reduce((sum, row) => sum + flt(row[config.amount_field]), 0);
	},

	// The counts the rail, the tiles and the queue cards all read. One
	// producer, one filter base — `_filters("status")` — and a null wherever
	// the count query failed, so nothing prints a zero it did not measure.
	_status_counts() {
		const counts = {};
		this._status_range().forEach((status) => {
			counts[status] = this.tally ? cint(this.tally[status]) : null;
		});
		return counts;
	},

	// The page total. It is the sum of exactly the rows the rail lists, so the
	// header, the rail's "All statuses" row and the status bar chart are three
	// renderings of one number.
	_population() {
		if (!this.tally) return null;
		const counts = this._status_counts();
		return Object.keys(counts).reduce((sum, status) => sum + cint(counts[status]), 0);
	},

	// The count of the LIST on screen. _population() deliberately ignores the
	// status the operator picked, because the rail needs a row per status; the
	// list does not, so the number heading it is the picked status's own count.
	_list_total() {
		const status = this.status.val();
		if (!status) return this._population();
		const counts = this._status_counts();
		return counts[status] === undefined ? null : counts[status];
	},

	_expiry_count(key) {
		if (!this.expiry_counts) return null;
		return cint(this.expiry_counts[key]);
	},

	// The population the expiry tally was taken over: every band plus the
	// records carrying no expiry date at all. It is the denominator a band's
	// share is measured against, and it is NOT _population(), which is summed
	// over a different filter base.
	_expiry_total() {
		if (!this.expiry_counts) return null;
		return IC_RISK.reduce(
			(sum, band) => sum + cint(this.expiry_counts[band.key]),
			cint(this.expiry_counts.none)
		);
	},

	// A tile's count and the denominator its share is stated against come from
	// the same query, never from two.
	_tile_count(tile) {
		if (tile.risk) return this._expiry_count(tile.risk);
		const counts = this._status_counts();
		return counts[tile.status] === undefined ? null : counts[tile.status];
	},

	_tile_total(tile) {
		return tile.risk ? this._expiry_total() : this._meter_total();
	},

	_meter_total() {
		return this._population();
	},

	_dimension_mode() {
		const keys = IC_PROJECT_MODES.map((entry) => entry.key);
		return keys.includes(this.dim_mode) ? this.dim_mode : keys[0];
	},

	_dimension_counts(mode) {
		return mode === "cost_center" ? this.cost_center_counts : this.project_counts;
	},

	_dimension_series(mode) {
		const counts = this._dimension_counts(mode);
		if (!counts) return null;
		return Object.keys(counts)
			.map((label) => ({ key: label, label: label, value: cint(counts[label]) }))
			.filter((entry) => entry.value)
			.sort((a, b) => b.value - a.value);
	},

	_dimension_total(mode) {
		const series = this._dimension_series(mode);
		if (!series) return null;
		return series.reduce((sum, entry) => sum + entry.value, 0);
	},

	// The rows this operator has to act on now, drawn from the loaded page. It
	// is a LIST of records rather than a count, so it is the only thing on the
	// dashboard that reads the loaded rows, and its heading says so.
	_needs_today() {
		return this._by_expiry(
			this.rows.filter((row) => this._is_working(row) && ic_days_left(row) <= IC_CRITICAL_DAYS)
		);
	},

	// D-25: a queue card can stand for more than one status, so this takes the
	// card's whole status list.
	_step_rows(statuses) {
		const wanted = Array.isArray(statuses) ? statuses : [statuses];
		return this._by_expiry(this.rows.filter((row) => wanted.includes(row.status)));
	},

	// K-14: a status outside _status_range() (Renewed/Rejected with Include
	// settled off) was never queried, so counts[status] is undefined and
	// cint(undefined) silently reads 0 — a measured zero and an unmeasured
	// population must not print the same digit. If ANY status this card
	// stands for falls outside the range currently in force, the whole card
	// is unmeasured: return null so the caller renders it the same em-dash
	// way ic_count_or_wait() already renders every other unmeasured count
	// (_tile_count above), instead of a confident, wrong "0".
	_step_count(counts, statuses) {
		if (!this.tally) return null;
		const range = this._status_range();
		const wanted = statuses || [];
		if (wanted.some((status) => !range.includes(status))) return null;
		return wanted.reduce((sum, status) => sum + cint(counts[status]), 0);
	},

	_selected_rows() {
		return this.rows.filter((row) => this.selected.has(row.name));
	},

	_row(name) {
		return this.rows.find((row) => row.name === name) || null;
	},
});

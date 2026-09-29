// Copyright (c) 2026, AFMCO and contributors

// The transition rule lives in ONE place: ic_legal_actions() in ic_utils.js.
// A second copy stood here, unreferenced since every caller moved, and the next
// reader would have taken it for the live one — it still carried the
// `!action.from.length` escape hatch that made "Update SADAD Number" the first
// button on every record. Deleted rather than left as a comment, because a
// named rule keeps being read as a rule.

// ROUND 10-B: the owner asked that the action dialogs — approve, reject and
// the rest — open as an inline DRAWER beside the record instead of a
// frappe.confirm/frappe.prompt popup. _run_action() is the ONE place every
// caller (Triage detail bar, Triage bulk bar, Batch step) reaches to fire an
// action, so converting it here converts all three surfaces without touching
// any of them.
//
// K-02: "preference" used to be the one action kept on the framework dialog,
// because it carried depends_on/mandatory_depends_on wiring the flat drawer
// form below cannot evaluate. The split in ic_utils.js's IC_ACTIONS removed
// that conditional field entirely — "preference" is a flat one-field form now
// — so the carve-out this comment used to justify is gone with it.
// IC_FRAMEWORK_DIALOG_ACTIONS and the frappe.prompt branch it drove are
// deleted; every fielded action converts through the one drawer below.

Object.assign(IqamaControl.prototype, {
	_run_action(action, rows) {
		const picked = rows && rows.length ? rows : this._selected_rows();
		if (!picked.length) {
			frappe.show_alert({ message: t("select_one"), indicator: "orange" });
			return;
		}
		if (picked.length > IC_ROW_LIMIT) {
			frappe.msgprint({
				title: ic_label(action.label),
				message: t("bulk_cap", IC_ROW_LIMIT),
				indicator: "red",
			});
			return;
		}

		// K-40: the message used to repeat the label, the count and the word
		// "confirm" a second time over what the title, subtitle and button
		// already say. Title and subtitle carry the label and the count;
		// message stays empty (hidden by _open_drawer's own .toggle) so the
		// confirm word appears exactly once, on the button.
		this._open_drawer({
			title: ic_label(action.label),
			subtitle: this._drawer_scope_text(picked),
			message: "",
			fields: action.fields ? action.fields(picked) : null,
			confirm_label: action.fields ? t("update") : t("confirm"),
			on_confirm: (values) => this._write_action(action, picked, values),
		});
	},

	// "Name what is about to happen and to how many records": one record gets
	// named by who it belongs to, a selection gets counted. Reused by every
	// drawer opener so the wording never drifts between the record actions and
	// the payment-request drawer below.
	_drawer_scope_text(rows) {
		if (rows.length === 1) return ic_row_name(rows[0]) || rows[0].name;
		return t("bulk_selected", rows.length);
	},

	// D-23 and D-24: the write is the moment the operator learns anything, so it
	// is the moment the page has to speak. Every action ends in a toast naming
	// what happened, and the destructive one carries its own way back.
	//
	// The undo payload is built BEFORE the write, out of the same keys the patch
	// is about to overwrite — so it restores exactly what this action changed
	// and touches nothing else. It is offered for ten seconds because that is
	// how long the alert stands; after that the record is what the operator
	// left it.
	_write_action(action, rows, values) {
		const patches = rows.map((row) => action.patch(row, values));
		const docs = rows.map((row, index) =>
			Object.assign({ doctype: IC_DOCTYPE, docname: row.name }, patches[index])
		);
		const before = rows.map((row, index) => this._previous_of(row, patches[index]));
		// K-06: what THIS action asked the row's status to become — the
		// patch's own value when it touches status, otherwise the status the
		// row already carried, since an action that never writes status
		// should never see it change either.
		const expected_status = rows.map((row, index) =>
			Object.prototype.hasOwnProperty.call(patches[index], "status") ? patches[index].status : row.status
		);

		const finish = (written) => {
			this._action_toast(action, written, before);
			rows.forEach((row) => delete this.history[row.name]);
			this.selected.clear();
			this.refresh();
		};

		frappe.dom.freeze(t("applying", ic_label(action.label)));
		frappe
			.xcall("frappe.client.bulk_update", { docs: JSON.stringify(docs) })
			.then((result) => {
				const failed = (result && result.failed_docs) || [];
				const failed_names = failed.map((entry) => entry.doc && entry.doc.docname);
				if (failed.length) {
					// K-10: bulk_update swallows the save's own exception into
					// failed_docs; a bare count told the operator a row was
					// dropped with no way to know why (e.g. a duration value
					// the DocType's Select does not carry). Defensive: the
					// exact shape of a failed_docs entry is not verifiable
					// against installed frappe source in this checkout, so
					// every plausible message property is tried and the toast
					// falls back to the count alone when none is present.
					const reasons = failed
						.map((entry) => ic_failed_doc_reason(entry))
						.filter(Boolean);
					frappe.msgprint({
						title: ic_label(action.label),
						message: reasons.length
							? `${t("not_updated_n", failed.length, rows.length)}<br>${reasons
									.map(ic_escape)
									.join("<br>")}`
							: t("not_updated_n", failed.length, rows.length),
						indicator: "orange",
					});
				}

				const succeeded = rows
					.map((row, index) => ({ row: row, index: index }))
					.filter((entry) => !failed_names.includes(entry.row.name));

				if (!succeeded.length) {
					finish(0);
					return;
				}

				// A reason this action collected but has no DocType field to
				// carry (ic_utils.js IC_ACTIONS' `comment` key) is posted to
				// each succeeded row's Timeline once the write is confirmed,
				// never before.
				if (action.comment) {
					succeeded.forEach((entry) => {
						const content = action.comment(entry.row, values);
						if (content) ic_post_comment(entry.row, content);
					});
				}

				// K-06: bulk_update reports this write as a success even when
				// a Before Save hook this page cannot see (server script
				// "iq 2", not in this tree) rewrote the row's status to
				// Rejected underneath it — that hook re-reads the employee's
				// live status at save time, after ic_action_allows() already
				// ran on the page's own copy. Reading the status back is the
				// only way this page can catch that divergence; it CANNOT
				// close the root cause, only refuse to call the result a
				// success.
				frappe.db
					.get_list(IC_DOCTYPE, {
						fields: ["name", "status"],
						filters: { name: ["in", succeeded.map((entry) => entry.row.name)] },
						limit: succeeded.length,
					})
					.then((current) => {
						const status_by_name = {};
						(current || []).forEach((doc) => (status_by_name[doc.name] = doc.status));

						const diverged = succeeded.filter(
							(entry) => status_by_name[entry.row.name] !== expected_status[entry.index]
						);

						if (diverged.length) {
							frappe.msgprint({
								title: ic_label(action.label),
								message: t("status_diverged_n", diverged.length),
								indicator: "red",
							});
						}

						// K-21: nothing in this file (or anywhere else on this
						// page) writes Employee.iqama_expiration_date — the
						// Form client script is the one authorised place that
						// derives it from renewal_duration. This only READS
						// the Employee record back and warns, with a link,
						// when it still holds the row's pre-renewal date.
						if (action.name === "mark_renewed") {
							const kept = succeeded.filter((entry) => !diverged.includes(entry));
							if (kept.length) this._warn_stale_employee_expiry(kept.map((entry) => entry.row));
						}

						finish(succeeded.length - diverged.length);
					})
					.catch(() => finish(0));
			})
			.catch((response) =>
				frappe.msgprint({
					title: ic_label(action.label),
					message: ic_error_text(response, t("bulk_failed")),
					indicator: "red",
				})
			)
			.then(() => frappe.dom.unfreeze());
	},

	// The row as it stood, narrowed to the fields this patch is about to write
	// PLUS status — K-06: status can change underneath a save this page never
	// asked to touch it (server script "iq 2"), so the undo doc always carries
	// enough to restore it even when the visible patch never mentioned it. A
	// field the row never carried restores as null rather than as undefined,
	// which bulk_update would drop.
	_previous_of(row, patch) {
		const doc = { doctype: IC_DOCTYPE, docname: row.name };
		const fields = new Set(Object.keys(patch));
		fields.add("status");
		fields.forEach((field) => {
			doc[field] = row[field] === undefined ? null : row[field];
		});
		return doc;
	},

	_action_toast(action, written, before) {
		if (!written) return;

		if (action.name === "sadad") {
			frappe.show_alert({ message: t("toast_sadad_saved"), indicator: "green" }, 7);
			return;
		}

		if (action.name !== "reject") {
			frappe.show_alert(
				{ message: t("toast_applied", ic_label(action.label), ic_count(written)), indicator: "green" },
				7
			);
			return;
		}

		frappe.show_alert(
			{
				message: t("toast_rejected"),
				indicator: "orange",
				body: `<button type="button" class="btn btn-xs ic-undo" data-action="undo">${ic_escape(
					t("undo")
				)}</button>`,
			},
			10,
			{ undo: () => this._undo_write(before) }
		);
	},

	// K-21: read-only check, fired only after mark_renewed's own write
	// succeeds. `rows` still carry their PRE-write iqama_expiration_date (the
	// closure captured them before bulk_update ran) — the row's OLD date. A
	// row's employee is reported here only when the Employee record's CURRENT
	// expiry still equals that old date, meaning nothing has updated the
	// master yet. Never writes Employee.iqama_expiration_date.
	_warn_stale_employee_expiry(rows) {
		const wanted = rows.filter((row) => row.employee);
		if (!wanted.length) return;

		frappe.db
			.get_list("Employee", {
				fields: ["name", "employee_name", "iqama_expiration_date"],
				filters: { name: ["in", wanted.map((row) => row.employee)] },
				limit: wanted.length,
			})
			.then((found) => {
				const by_name = {};
				(found || []).forEach((doc) => (by_name[doc.name] = doc));

				const stale = wanted.filter((row) => {
					const employee = by_name[row.employee];
					return employee && employee.iqama_expiration_date === row.iqama_expiration_date;
				});
				if (!stale.length) return;

				const items = stale
					.map((row) => {
						const employee = by_name[row.employee];
						return `<li>${ic_escape(row.employee_name || row.employee)} — ${ic_escape(
							t("employee_expiry_still", ic_date(employee.iqama_expiration_date))
						)} — <a href="${frappe.utils.get_form_link("Employee", row.employee)}">${ic_escape(
							row.employee
						)}</a></li>`;
					})
					.join("");

				frappe.msgprint({
					title: t("employee_expiry_stale_n", stale.length),
					message: `<ul>${items}</ul>`,
					indicator: "orange",
				});
			})
			.catch(() => {});
	},

	_undo_write(before) {
		if (!before || !before.length) return;

		frappe.dom.freeze(t("undo"));
		frappe
			.xcall("frappe.client.bulk_update", { docs: JSON.stringify(before) })
			.then((result) => {
				const failed = (result && result.failed_docs) || [];
				if (failed.length) {
					frappe.msgprint({
						title: t("undo"),
						message: t("not_updated_n", failed.length, before.length),
						indicator: "orange",
					});
				}
				before.forEach((doc) => delete this.history[doc.docname]);
				this.refresh();
				frappe.show_alert({ message: t("undone"), indicator: "blue" }, 5);
			})
			.catch((response) =>
				frappe.msgprint({
					title: t("undo"),
					message: ic_error_text(response, t("undo_failed")),
					indicator: "red",
				})
			)
			.then(() => frappe.dom.unfreeze());
	},

	// K-09: the eligibility test itself moved to ic_utils.js's ic_skip_reason —
	// IC_ACTIONS' confirm_payment/mark_renewed/cancel_pr guards need it with no
	// `this` receiver, and this method used no `this` internally even before
	// the move, so nothing about what it tests changed.

	_remark_block(row, config) {
		const lines = [
			`Document: ${row.name}`,
			`Employee: ${row.employee}`,
			`Employee Name: ${row.employee_name}`,
			`Iqama Expiration Date: ${row.iqama_expiration_date || ""}`,
			`New Iqama Expiration Date: ${row.iqama_new_expiration_date || ""}`,
			`Renewal Duration: ${row.renewal_duration || ""}`,
			`Cost Center: ${row.cost_center || ""}`,
			`Department: ${row.department || ""}`,
			`Corporation: ${row.corporation || ""}`,
		];
		if (config.requires_sadad) lines.push(`SADAD Invoice: ${row.sadad_invoice || ""}`);
		lines.push(`Amount: ${flt(row[config.amount_field])}`);
		lines.push("------------------------");
		return lines.join("\n");
	},

	_next_pr_status(current, payment_type) {
		const other = Object.keys(IC_PAYMENT_TYPES).find((type) => type !== payment_type);
		return current === other || current === IC_BOTH ? IC_BOTH : payment_type;
	},

	// Item 1 (round 8c): _detail_entries() and _render_bulk_bar() (both
	// ic_triage.js) both need "offer this payment type, disabled with a reason
	// when it cannot run" over a set of rows -- one row for the detail bar, the
	// whole selection for the bulk bar. ONE builder keyed off _skip_reason(),
	// so the reason text never drifts between the two surfaces. A type is
	// disabled only when EVERY row in the set would be skipped; the reason
	// shown is that row's own reason when there is exactly one (the detail
	// bar's case), and the shared "nothing eligible" message otherwise, since
	// a mixed bulk selection's individual reasons differ per row and
	// _create_pr() already reports each one by name in its own result dialog.
	_payment_entries(rows, activate) {
		if (!(this.can_create_pr && this.can_write)) return [];
		return Object.keys(IC_PAYMENT_TYPES).map((type) => {
			const config = IC_PAYMENT_TYPES[type];
			const reasons = rows.map((row) => ic_skip_reason(row, config, type));
			const eligible = reasons.filter((reason) => !reason).length;
			return {
				label: t(IC_PR_ACTION_KEY[type]),
				disabled: eligible === 0,
				reason: eligible === 0 ? reasons[0] || t("pr_none_eligible") : "",
				action: () => activate(type),
			};
		});
	},

	// K-16: accepts the same (action-like, rows) shape _run_action does — the
	// Triage detail bar and batch bar now pass their own rows explicitly
	// instead of this reading this.selected, so a detail-bar request can never
	// silently replace the operator's whole selection.
	_create_pr(payment_type, rows) {
		if (this._creating) return;
		const config = IC_PAYMENT_TYPES[payment_type];
		const picked = rows && rows.length ? rows : this._selected_rows();

		if (!picked.length) {
			frappe.show_alert({ message: t("select_one"), indicator: "orange" });
			return;
		}

		const eligible = [];
		const skipped = [];
		picked.forEach((row) => {
			const reason = ic_skip_reason(row, config, payment_type);
			if (reason) skipped.push({ row: row, reason: reason });
			else eligible.push(row);
		});

		if (!eligible.length) {
			this._show_result(skipped);
			return;
		}

		// CHEQUE step 4 / K-07: an open sibling at the same employee AND
		// expiry date that already carries a PR reference is a WARNING band,
		// never a skip — _sibling_records (ic_store.js) is a live,
		// scope-ignoring query, so it sees a sibling the page's own default
		// window would otherwise hide entirely.
		Promise.all(
			eligible.map((row) =>
				this._sibling_records(row).then((siblings) => ({
					row: row,
					siblings: siblings.filter((sib) => sib.custom_pr_reference || sib.custom_pr_reference_2),
				}))
			)
		).then((entries) => {
			this._open_pr_front(payment_type, config, eligible, skipped, entries.filter((entry) => entry.siblings.length));
		});
	},

	// CHEQUE steps 1-4: the FRONT FACE. Payee (fixed per type — the operator
	// never chooses it), eligible count, the exact total through
	// ic_store.js's _type_amount (K-13 — never _due_amount, which sums both
	// fee fields and would print roughly double), the per-record list, the
	// skipped band with its reason breakdown (K-12, before any write), and the
	// sibling warning band (K-07). keep_open tells _open_drawer not to close
	// on confirm — the SAME panel then shows the back face once the insert
	// resolves (CHEQUE step 5), so nothing flips optimistically and a
	// rejected insert leaves this face standing with the error.
	_open_pr_front(payment_type, config, eligible, skipped, sibling_warnings) {
		const total = this._type_amount(eligible, payment_type);

		const rows_html = eligible
			.map(
				(row) =>
					`<tr><td>${ic_escape(row.employee)}</td><td>${ic_escape(ic_row_name(row))}</td>` +
					`<td>${ic_escape(row.sadad_invoice || "")}</td>` +
					`<td>${ic_escape(ic_money(flt(row[config.amount_field])))}</td></tr>`
			)
			.join("");

		const bands = [
			`<p class="ic-pr-payee"><b>${ic_escape(t("pr_payee"))}:</b> ${ic_escape(config.beneficiary)}</p>`,
			`<p class="ic-pr-total">${ic_escape(t("pr_eligible_total", eligible.length, ic_money_or_none(total)))}</p>`,
			`<table class="ic-pr-rows"><tbody>${rows_html}</tbody></table>`,
		];

		// K-12: a string distinct from the bulk bar's "{0} selected" so the
		// two counts on screen never share one label.
		if (skipped.length) {
			bands.push(
				`<div class="ic-pr-skipped"><p><b>${ic_escape(
					t("count_suffix", t("skipped"), skipped.length)
				)}</b></p><ul>${skipped
					.map(
						(entry) =>
							`<li>${ic_escape(entry.row.employee_name || entry.row.name)} — ${ic_escape(
								entry.reason
							)}</li>`
					)
					.join("")}</ul></div>`
			);
		}

		if (sibling_warnings.length) {
			bands.push(
				`<div class="ic-pr-siblings"><p><b>${ic_escape(
					t("pr_sibling_warning_n", sibling_warnings.length)
				)}</b></p><ul>${sibling_warnings
					.map(
						(entry) =>
							`<li>${ic_escape(ic_row_name(entry.row))} — ${entry.siblings
								.map((sib) =>
									ic_escape(sib.custom_pr_reference || sib.custom_pr_reference_2 || sib.name)
								)
								.join(", ")}</li>`
					)
					.join("")}</ul></div>`
			);
		}

		this._open_drawer({
			title: t("payment_request"),
			subtitle: this._drawer_scope_text(eligible),
			message: "",
			html: bands.join(""),
			fields: null,
			confirm_label: t("confirm"),
			keep_open: true,
			on_confirm: () => this._insert_pr(payment_type, config, eligible),
		});
	},

	_insert_pr(payment_type, config, eligible) {
		this._creating = true;
		const today = frappe.datetime.nowdate();
		const total = this._type_amount(eligible, payment_type);
		const request = Object.assign({ doctype: IC_EXPENSE_DOCTYPE }, IC_PR_DEFAULTS, {
			beneficiary_name: config.beneficiary,
			amount: flt(total, 2),
			date: today,
			bank_payment_date: today,
			remark: eligible.map((row) => this._remark_block(row, config)).join("\n"),
		});

		frappe.dom.freeze(t("creating_pr"));

		frappe.db
			.insert(request)
			.then((payment_request) => {
				const updates = eligible.map((row) => {
					const patch = {
						doctype: IC_DOCTYPE,
						docname: row.name,
						pr_status: this._next_pr_status(row.pr_status, payment_type),
					};
					patch[config.reference_field] = payment_request.name;
					return patch;
				});

				return frappe
					.xcall("frappe.client.bulk_update", { docs: JSON.stringify(updates) })
					.then((result) => {
						const failed = (result && result.failed_docs) || [];
						const failed_names = failed.map((entry) => entry.doc && entry.doc.docname);

						// K-08 / CHEQUE step 5: a row whose LINK write failed
						// already carries the money the request was raised
						// for — it is UNLINKED, not skipped, and stays in its
						// own band, never merged into the pre-flight `skipped`
						// list the front face already showed.
						const unlinked = failed.map(
							(entry) =>
								eligible.find((candidate) => candidate.name === (entry.doc && entry.doc.docname)) || {
									name: entry.doc && entry.doc.docname,
									employee_name: "",
								}
						);
						const updated = eligible.filter((row) => !failed_names.includes(row.name));

						this._render_pr_back(payment_request, updated, unlinked, flt(total, 2));

						eligible.forEach((row) => delete this.history[row.name]);
						this.selected.clear();
						this.refresh();
						frappe.show_alert(
							{ message: t("toast_pr_created", payment_request.name), indicator: "green" },
							7
						);
					});
			})
			.catch((response) => {
				// CHEQUE step 5: a rejected insert leaves the front face
				// standing with the error; nothing flips optimistically, so
				// this reports onto the panel already open rather than
				// opening a second one.
				frappe.msgprint({
					title: t("payment_request"),
					message: ic_error_text(response, t("pr_failed")),
					indicator: "red",
				});
			})
			.then(() => {
				this._creating = false;
				frappe.dom.unfreeze();
			});
	},

	// CHEQUE steps 5 & 7: the BACK FACE, rendered only once the insert
	// resolves — the created request as a link, the linked count, the
	// unlinked band (K-08, its own band, never under Skipped), and a plain
	// statement of how to undo. CHEQUE step 7 offers two ways to close K-09's
	// undo gap: ship cancel_pr and put it on this face, or state plainly that
	// this cannot be undone from here. This takes the plain-statement branch —
	// cancel_pr already rides the generic transition bar everywhere else on
	// the page (ic_batch.js, ic_triage.js), and wiring a second live write
	// path inside a result panel would be a second copy of _run_action.
	_render_pr_back(payment_request, updated, unlinked, amount) {
		const bands = [
			`<p>${ic_escape(t("created"))}: <a href="${frappe.utils.get_form_link(
				"Expense Request Afmco",
				payment_request.name
			)}">${ic_escape(payment_request.name)}</a> — ${ic_escape(ic_money(amount))}</p>`,
			`<p>${ic_escape(t("updated_records"))}: <b>${ic_count(updated.length)}</b></p>`,
		];

		if (unlinked.length) {
			bands.push(
				`<div class="ic-pr-unlinked"><p><b>${ic_escape(
					t("pr_unlinked_n", unlinked.length, payment_request.name)
				)}</b></p><ul>${unlinked
					.map((row) => `<li>${ic_escape(row.employee_name || row.name)}</li>`)
					.join("")}</ul></div>`
			);
		}

		bands.push(`<p class="ic-pr-undo-note">${ic_escape(t("pr_cancel_hint"))}</p>`);

		this._open_drawer({
			title: t("payment_request"),
			subtitle: payment_request.name,
			message: "",
			html: bands.join(""),
			fields: null,
			confirm_label: t("close"),
			keep_open: false,
			on_confirm: () => {},
		});
	},

	// The only remaining caller is the zero-eligible case in _create_pr —
	// every other outcome now goes through _open_pr_front / _render_pr_back
	// above, in the same drawer the operator already has open.
	_show_result(skipped) {
		const lines = [`<p>${ic_escape(t("pr_none_eligible"))}</p>`];

		if (skipped.length) {
			lines.push(`<p><b>${ic_escape(t("count_suffix", t("skipped"), skipped.length))}</b></p>`);
			lines.push(
				`<ul class="ic-skip-list">${skipped
					.map(
						(entry) =>
							`<li>${ic_escape(entry.row.employee_name || entry.row.name)} — ${ic_escape(
								entry.reason
							)}</li>`
					)
					.join("")}</ul>`
			);
		}

		frappe.msgprint({ title: t("payment_request"), message: lines.join(""), indicator: "blue" });
	},

	_copy_selected() {
		const picked = this._selected_rows();
		if (!picked.length) {
			frappe.show_alert({ message: t("select_one"), indicator: "orange" });
			return;
		}
		this._export(picked);
	},

	_copy_recent() {
		frappe.prompt(
			[
				{
					fieldname: "minutes",
					fieldtype: "Int",
					label: t("f_recent_minutes"),
					default: 120,
					reqd: 1,
				},
			],
			(values) => {
				const since = frappe.datetime.add_to_date(frappe.datetime.now_datetime(), {
					minutes: -cint(values.minutes),
				});

				// note.3: the archive line binds every read this page makes,
				// including this one. A record older than three months is not
				// on the board, so it is not in what the board copies out.
				// K-19: the sadad_invoice clause used to be hard-coded here,
				// a second writer of the same key only_with_sadad already
				// writes inside this._filters() (ic_store.js) — as the LATER
				// argument to Object.assign it always won, so unticking the
				// operator's own checkbox could never widen this export.
				frappe.db
					.get_list(IC_DOCTYPE, {
						fields: IC_FIELDS,
						filters: Object.assign({}, this._filters("status"), {
							modified: [">=", since],
						}),
						order_by: "modified desc",
						limit: IC_ROW_LIMIT,
					})
					.then((rows) => this._export(rows || []));
			},
			t("copy_recent"),
			t("copy")
		);
	},

	_export(rows) {
		if (!rows.length) {
			frappe.show_alert({ message: t("nothing_to_copy"), indicator: "orange" });
			return;
		}

		this._outside_map(rows).then((outside) => {
			this._copy_rows(rows.map((row) => this._sheet_row(row, outside)));
		});
	},

	_outside_map(rows) {
		const employees = rows.map((row) => row.employee).filter(Boolean);
		if (!IC_OUTSIDE_KSA_FIELD || !employees.length) return Promise.resolve({});

		return frappe.db
			.get_list("Employee", {
				fields: ["name", IC_OUTSIDE_KSA_FIELD],
				filters: { name: ["in", employees] },
				limit: IC_ROW_LIMIT,
			})
			.then((found) => {
				const map = {};
				(found || []).forEach((row) => {
					const value = row[IC_OUTSIDE_KSA_FIELD];
					if (value === 1 || value === "1" || value === true) map[row.name] = __('Yes', null, 'Iqama Control');
					else if (!value) map[row.name] = __('No', null, 'Iqama Control');
					else map[row.name] = String(value);
				});
				return map;
			})
			.catch(() => ({}));
	},

	_sheet_row(row, outside) {
		return [
			row.employee,
			row.employee_name,
			row.company_name || row.corporation,
			ic_sheet_date(row.iqama_expiration_date),
			outside[row.employee],
			row.file_no,
			ic_label(row.status),
			ic_project_label(row),
			IC_DATE_COLUMN_FIELD ? ic_sheet_date(row[IC_DATE_COLUMN_FIELD]) : "",
			row.sadad_invoice,
			ic_sheet_amount(row.work_permit_fee),
			row.custom_pr_reference,
			row.custom_pr_reference_2,
			row.reason_of_preventing_renewal || row.reason_of_not_renew,
		].map(ic_cell);
	},

	_copy_rows(rows) {
		const tsv = rows.map((row) => row.join("\t")).join("\n");
		const html =
			"<table><tbody>" +
			rows
				.map(
					(row) =>
						`<tr>${row
							.map((value, index) => {
								const style = IC_TEXT_COLUMNS.includes(index)
									? " style=\"mso-number-format:'\\@'\""
									: "";
								return `<td${style}>${ic_escape(value)}</td>`;
							})
							.join("")}</tr>`
				)
				.join("") +
			"</tbody></table>";

		this._write_clipboard(tsv, html)
			.then(() =>
				frappe.show_alert({
					message: t("toast_copied_n", rows.length),
					indicator: "green",
				})
			)
			.catch(() => this._fallback_dialog(tsv));
	},

	_write_clipboard(text, html) {
		if (navigator.clipboard && window.ClipboardItem) {
			try {
				const item = new window.ClipboardItem({
					"text/plain": new Blob([text], { type: "text/plain" }),
					"text/html": new Blob([html], { type: "text/html" }),
				});
				return navigator.clipboard.write([item]);
			} catch (error) {
				return navigator.clipboard.writeText(text);
			}
		}
		if (navigator.clipboard && navigator.clipboard.writeText) {
			return navigator.clipboard.writeText(text);
		}
		return Promise.reject(new Error("clipboard unavailable"));
	},

	_fallback_dialog(text) {
		const dialog = new frappe.ui.Dialog({
			title: t("copy_manually"),
			fields: [{ fieldname: "payload", fieldtype: "Code", label: t("rows"), default: text }],
		});
		dialog.show();
	},

	// ── THE DRAWER ───────────────────────────────────────────────────────────
	//
	// One inline panel, built once and reused, driven entirely from opts:
	//   title          drawer heading (the action's own label)
	//   subtitle       what it is about to happen to — _drawer_scope_text()
	//   message        a plain sentence, shown when the action has no fields
	//   fields         the same field array action.fields() already returns,
	//                  or null for a confirm-only action
	//   confirm_label  the primary button's text
	//   on_confirm(values)  called with a plain {fieldname: value} object,
	//                  exactly what frappe.prompt used to hand the same caller
	//
	// It slides in from the inline end of the page instead of covering it —
	// the scrim behind it is fully transparent, kept only to catch an
	// outside click, so the record list stays visible and readable while the
	// drawer is open.
	// K-05: the drawer used to hang off this.$view, and render() empties that
	// node on every view switch. jQuery's empty() strips the handlers off the
	// subtree as it detaches it, so the cached $drawer came back mute — close,
	// cancel and confirm all fired nothing, and every drawer opened after the
	// first view switch was dead. page.main is the one host that outlives a
	// render, and both the drawer and its scrim are position:fixed, so which
	// element they hang off never affected where they sit. The containment
	// test is the guard, not the mount: any future host that gets emptied is
	// caught here and the drawer is rebuilt instead of reused.
	_ensure_drawer() {
		if (this.$drawer && this.$drawer.length && document.contains(this.$drawer[0])) {
			return this.$drawer;
		}
		if (this.$drawer) this.$drawer.remove();
		if (this.$drawer_scrim) this.$drawer_scrim.remove();

		const $host = this.page.main || this.$view;
		const $scrim = $('<div class="ic-drawer-scrim"></div>').appendTo($host);
		const $drawer = $('<aside class="ic-drawer" role="dialog" aria-modal="true"></aside>')
			.attr("dir", IC_DIR)
			.appendTo($host);

		const $header = $('<div class="ic-drawer-head"></div>').appendTo($drawer);
		const $titles = $('<div class="ic-drawer-titles"></div>').appendTo($header);
		$('<h3 class="ic-drawer-title"></h3>').appendTo($titles);
		$('<p class="ic-drawer-subtitle"></p>').appendTo($titles);
		$('<button type="button" class="ic-drawer-close"><span aria-hidden="true">&times;</span></button>')
			.attr("aria-label", t("cancel"))
			.appendTo($header);

		$('<p class="ic-drawer-message"></p>').appendTo($drawer);
		// CHEQUE steps 1-5: a raw-HTML band host for the payment-request front
		// and back faces (payee, per-record list, skip/sibling/unlinked
		// bands) — the plain-text .ic-drawer-message above cannot carry a
		// table or a list. Every other action leaves this empty and hidden.
		$('<div class="ic-drawer-html"></div>').appendTo($drawer);
		$('<div class="ic-drawer-fields"></div>').appendTo($drawer);

		const $footer = $('<div class="ic-drawer-foot"></div>').appendTo($drawer);
		$('<button type="button" class="ic-btn ic-drawer-cancel"></button>').text(t("cancel")).appendTo($footer);
		$('<button type="button" class="ic-btn ic-btn--primary ic-drawer-confirm"></button>').appendTo($footer);

		$drawer.on("keydown", (event) => this._drawer_keydown(event));
		$drawer.find(".ic-drawer-close").on("click", () => this._close_drawer());
		$scrim.on("click", () => this._close_drawer());

		this.$drawer = $drawer;
		this.$drawer_scrim = $scrim;
		return $drawer;
	},

	_drawer_keydown(event) {
		if (event.key === "Escape") {
			event.stopPropagation();
			this._close_drawer();
			return;
		}
		if (event.key !== "Tab") return;

		const $focusable = this.$drawer
			.find('button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
			.filter(":visible");
		if (!$focusable.length) return;

		const first = $focusable.get(0);
		const last = $focusable.get($focusable.length - 1);

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	},

	// One row per field, a plain flat form — no depends_on engine, which is
	// exactly why "preference" (the one action that needs one) stays on
	// frappe.prompt instead of coming through here. Returns a small
	// controller so _open_drawer can read, validate and flag each field
	// without caring which fieldtype it renders as.
	_render_drawer_field($body, field) {
		const $row = $('<div class="ic-drawer-field"></div>').appendTo($body);
		const input_id = `ic-drawer-f-${field.fieldname}`;
		let $input;

		if (field.fieldtype === "Check") {
			const $check = $('<label class="ic-drawer-field-check"></label>').appendTo($row);
			$input = $('<input type="checkbox">').attr("id", input_id).appendTo($check);
			$('<span></span>').text(field.label).appendTo($check);
			// K-11 point 3: field.default now reaches this renderer — only
			// checked when every row a bulk action was fired over already
			// agreed on the value (ic_common_value, ic_utils.js).
			if (field.default) $input.prop("checked", true);
		} else {
			const $label = $('<label class="ic-drawer-field-label"></label>')
				.attr("for", input_id)
				.text(field.label)
				.appendTo($row);
			if (field.reqd) $('<span class="ic-drawer-field-req">*</span>').appendTo($label);

			if (field.fieldtype === "Small Text" || field.fieldtype === "Text") {
				$input = $('<textarea class="ic-drawer-field-input" rows="3"></textarea>');
			} else if (field.fieldtype === "Date") {
				$input = $('<input type="date" class="ic-drawer-field-input">');
			} else if (field.fieldtype === "Select") {
				$input = $('<select class="ic-drawer-field-input"></select>');
				(field.options || []).forEach((option) =>
					$('<option></option>').attr("value", option).text(ic_label(option) || option).appendTo($input)
				);
			} else {
				$input = $('<input type="text" class="ic-drawer-field-input">');
			}
			$input.attr("id", input_id).appendTo($row);
			// K-11 point 3/4: same default-when-every-row-agrees rule as the
			// Check branch above.
			if (field.default !== undefined && field.default !== null) $input.val(field.default);
		}

		// K-11 point 5: "state the duration change before applying it, as the
		// original did" — a static hint under the field rather than a live
		// on-change handler, since this flat drawer form has no depends_on
		// engine to react through (see the comment above this method).
		if (field.description) $('<p class="ic-drawer-field-desc"></p>').text(field.description).appendTo($row);

		const $error = $('<div class="ic-drawer-field-error" role="alert"></div>').appendTo($row);

		return {
			field: field,
			get_value: () => (field.fieldtype === "Check" ? ($input.is(":checked") ? 1 : 0) : $input.val()),
			is_empty: () => (field.fieldtype === "Check" ? false : !String($input.val() || "").trim()),
			set_error(message) {
				$row.addClass("ic-drawer-field--error");
				$error.text(message);
			},
			clear_error() {
				$row.removeClass("ic-drawer-field--error");
				$error.text("");
			},
			focus: () => $input.trigger("focus"),
		};
	},

	_open_drawer(opts) {
		const $drawer = this._ensure_drawer();
		this._drawer_return_focus = document.activeElement;

		$drawer.find(".ic-drawer-title").text(opts.title || "");
		$drawer.find(".ic-drawer-subtitle").text(opts.subtitle || "");
		$drawer
			.find(".ic-drawer-message")
			.text(opts.message || "")
			.toggle(Boolean(opts.message));

		// CHEQUE steps 1-5: opts.html is trusted markup this file itself
		// built with ic_escape() around every row-derived value (see
		// _open_pr_front / _render_pr_back) — never raw operator or record
		// input passed straight through.
		const $html = $drawer.find(".ic-drawer-html").empty();
		if (opts.html) $html.html(opts.html).show();
		else $html.hide();

		const $body = $drawer.find(".ic-drawer-fields").empty();
		const controls = (opts.fields || []).map((field) => this._render_drawer_field($body, field));

		const $confirm = $drawer.find(".ic-drawer-confirm").text(opts.confirm_label || t("update"));
		const $cancel = $drawer.find(".ic-drawer-cancel");

		$confirm.off("click").on("click", () => {
			const values = {};
			let first_invalid = null;
			controls.forEach((control) => {
				if (control.field.reqd && control.is_empty()) {
					control.set_error(t("field_required"));
					first_invalid = first_invalid || control;
					return;
				}
				control.clear_error();
				values[control.field.fieldname] = control.get_value();
			});
			if (first_invalid) {
				first_invalid.focus();
				return;
			}
			// CHEQUE step 5: keep_open leaves the SAME panel standing across
			// the front-face confirm — _insert_pr swaps its content to the
			// back face once the write resolves, rather than closing here and
			// opening a second surface. Every other caller closes as before.
			if (!opts.keep_open) this._close_drawer();
			opts.on_confirm(values);
		});
		$cancel.off("click").on("click", () => this._close_drawer());

		$drawer.addClass("ic-drawer--open");
		this.$drawer_scrim.addClass("ic-drawer-scrim--open");

		const $first_field = $body.find("input, select, textarea").first();
		if ($first_field.length) $first_field.trigger("focus");
		else $confirm.trigger("focus");
	},

	_close_drawer() {
		if (!this.$drawer) return;
		this.$drawer.removeClass("ic-drawer--open");
		this.$drawer_scrim.removeClass("ic-drawer-scrim--open");
		if (this._drawer_return_focus && this._drawer_return_focus.focus) {
			try {
				this._drawer_return_focus.focus();
			} catch (error) {
				/* the trigger may already be gone after a refresh; nothing to return to */
			}
		}
		this._drawer_return_focus = null;
	},
});

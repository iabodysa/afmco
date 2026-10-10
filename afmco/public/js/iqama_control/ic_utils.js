// Copyright (c) 2026, AFMCO and contributors

function ic_escape(value) {
	return frappe.utils.escape_html(value === null || value === undefined ? "" : String(value));
}

// D-15: one placement of the SAR symbol for the whole page. format_currency
// reads the site's own currency format, which put the symbol before the number
// in the detail panel and after it on the dashboard for the same 2,588.00.
function ic_money(value) {
	const amount = flt(value);
	return IC_FMT_SAR.format(Number.isFinite(amount) ? amount : 0);
}

// D-17: zero is not an amount here. Every fee on this DocType is written by the
// renewal-preference step, so a null or a zero means "not calculated yet", and
// rendering it as 0.00 told the operator a bill of nothing was due.
function ic_has_amount(value) {
	return flt(value) > 0;
}

function ic_money_or_none(value) {
	return ic_has_amount(value) ? ic_money(value) : t("not_calculated");
}

// A record whose two fees are both unwritten cannot be paid and must not stand
// in the Payment step counting against the batch.
function ic_fees_missing(row) {
	return !ic_has_amount(row.work_permit_fee) && !ic_has_amount(row.iqama_renewal_amount);
}

// F-15: a history diff carried the raw field value — an ISO date, a bare
// number, a stored Select code — while the same field elsewhere on the page
// always went through a formatter. One dispatcher, keyed on the same
// IC_DATE_FIELDS / IC_MONEY_FIELDS lists the field grid already reads, so a
// history value reads exactly like its live counterpart. A Link or free-text
// value has no page-wide formatter, so it passes through ic_label(), which
// itself falls back to the raw string when it holds no translation.
function ic_history_value(fieldname, value) {
	if (value === null || value === undefined || value === "") return "";
	if (IC_DATE_FIELDS.includes(fieldname)) return ic_date(value) || String(value);
	if (IC_MONEY_FIELDS.includes(fieldname)) return ic_money(value);
	return ic_label(value);
}

// note.3: the age line. Everything the page counts, lists or charts is narrowed
// to records created on or after this day, so a single concept can never show a
// number taken over one window beside a list taken over another. An empty
// answer is the whole table, which is what the "all records" option asks for.
function ic_scope_floor(key) {
	const scope = IC_SCOPES.find((entry) => entry.key === key);
	if (!scope) return "";
	const today = frappe.datetime.get_today();
	if (scope.months) return String(frappe.datetime.add_months(today, -scope.months)).slice(0, 10);
	if (scope.days) return String(frappe.datetime.add_days(today, -scope.days)).slice(0, 10);
	return "";
}

// DATA-01: imported names carry a placeholder where a middle name was missing —
// "MD - - SABUJ", "SORG RAM - SHAND". The dashes are not part of anybody's
// name, so they are collapsed on render. The stored value is untouched; the
// data layer owns the merge.
const IC_NAME_PLACEHOLDER = /\s+-(?:\s+-)+\s+/g;
const IC_NAME_TAIL = /(?:^\s*-\s+|\s+-\s*$)/g;

function ic_person_name(value) {
	return String(value === null || value === undefined ? "" : value)
		.replace(IC_NAME_PLACEHOLDER, " ")
		.replace(IC_NAME_TAIL, "")
		.trim();
}

function ic_row_name(row) {
	return ic_person_name(row.employee_name || row.employee || "");
}

// The one test for "is this day count inside this band". Both bounds are days
// remaining and both are inclusive, which is exactly what the server's BETWEEN
// on the expiry date does, so the client and the query agree by construction.
function ic_in_band(band, days) {
	if (band.from !== undefined && days < band.from) return false;
	if (band.to !== undefined && days > band.to) return false;
	return true;
}

function ic_band_of(bands, days) {
	return bands.find((band) => ic_in_band(band, days)) || null;
}

function ic_band(key) {
	return IC_BANDS.find((band) => band.key === key) || null;
}

function ic_cell(value) {
	if (value === null || value === undefined) return "";
	return String(value).split(/\s+/).filter(Boolean).join(" ");
}

function ic_sheet_date(value) {
	if (!value) return "";
	const parts = String(value).slice(0, 10).split("-");
	if (parts.length !== 3) return String(value);
	return `${cint(parts[2])}/${cint(parts[1])}/${parts[0]}`;
}

function ic_sheet_amount(value) {
	const amount = flt(value);
	if (!amount) return "";
	return amount === Math.round(amount) ? String(Math.round(amount)) : amount.toFixed(2);
}

// D-19: two letters carry a Latin name and destroy an Arabic one. Dozens of
// employees here are named عبد-something, so first-plus-last initials collapse
// them all to the same two glyphs. An Arabic name gets its whole first name in
// the avatar instead; the css gives that avatar room to be an oval.
const IC_ARABIC = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

function ic_is_arabic(name) {
	return IC_ARABIC.test(String(name || ""));
}

function ic_initials(name) {
	const parts = String(name || "")
		.split(/\s+/)
		.filter(Boolean);
	if (!parts.length) return "?";
	if (ic_is_arabic(parts[0])) return parts[0];
	return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

// ITEM 1(b): the source `first_name` field on Employee holds the WHOLE name
// ("RAJA ARSLAN ALI BASHARAT ALI KHAN"), never just a given name, so "first
// name" here can only mean the FIRST WORD of whatever name string the row
// carries. This replaces the two-letter ic_initials() fallback the owner
// asked off: a photo-less avatar now shows that first word, not two letters.
function ic_first_name(name) {
	const parts = String(name || "")
		.split(/\s+/)
		.filter(Boolean);
	return parts.length ? parts[0] : "?";
}

function ic_days_left(row) {
	if (!row || !row.iqama_expiration_date) return 9999;
	return cint(frappe.datetime.get_day_diff(row.iqama_expiration_date, frappe.datetime.get_today()));
}

// D-16: ONE source for what a record's expiry date means. The list badge, the
// badge's title, the detail chip and the dashboard row all read this, so the
// three can no longer disagree.
//
// Sign convention, held everywhere: the number is days REMAINING, so a past
// expiry is negative and the sentence beside it says "overdue". The list column
// header carries the unit, which is why the badge itself carries none.
function ic_expiry_state(row) {
	if (!row || !row.iqama_expiration_date) {
		return { days: null, tone: "none", short: "—", long: t("no_expiry") };
	}

	const days = ic_days_left(row);

	if (days < 0) {
		return {
			days: days,
			tone: "critical",
			short: `-${Math.abs(days)}`,
			long: t("overdue_days", Math.abs(days)),
		};
	}
	if (days === 0) {
		return { days: 0, tone: "critical", short: "0", long: t("due_today") };
	}
	if (days <= IC_SOON_DAYS) {
		return {
			days: days,
			tone: days <= IC_CRITICAL_DAYS ? "critical" : "attention",
			short: String(days),
			long: t("due_in_days", days),
		};
	}
	return {
		days: days,
		tone: "neutral",
		short: String(days),
		long: ic_date(row.iqama_expiration_date),
	};
}

// ITEM 2: a settled record (IC_SETTLED, ic_store.js:_is_settled) is closed
// work. Its expiry date can still be in the past — a Renewed record's OLD
// expiry always is, and its NEW one may since have slipped by too — but
// nothing is waiting on it any more, so it must read as its status, never as
// overdue. Tone "none" and urgency "none" reuse the exact styling an expiry
// date already wears when the record carries none at all (ic_expiry_state's
// own first branch, ic_urgency(9999)), so this needs no new CSS.
function ic_settled_expiry_state(row) {
	const label = ic_label(row && row.status);
	return { days: null, tone: "none", short: label, long: label };
}

function ic_urgency(days) {
	if (days === 9999) return "none";
	if (days < 0) return "expired";
	if (days <= IC_CRITICAL_DAYS) return "critical";
	if (days <= IC_SOON_DAYS) return "soon";
	return "clear";
}

function ic_band_key(band) {
	const text = String(band).toLowerCase();
	if (text.includes("احمر") || text.includes("red")) return "red";
	if (text.includes("اصفر") || text.includes("yellow")) return "yellow";
	if (text.includes("بلاتين") || text.includes("platinum")) return "platinum";
	if (text.includes("اخضر") || text.includes("green")) return "green";
	return "unknown";
}

// G-11: department and cost_center are dash-joined "English - ... - Arabic -
// ... - code" strings; the row, the project filter option and the dashboard
// grouping (ic_store.js:_count_by_project, which builds the SAME distinct set
// the filter dropdown reads) all called this one function and all showed the
// whole string. One name now comes out everywhere: the first Arabic segment
// when the source carries Arabic, the first segment otherwise. Called both as
// ic_project_label(row) — the row/store contract this function already had —
// and as ic_project_label(sourceString) for a value not attached to a row, so
// a second function was not needed for the second shape.
function ic_project_label(source_or_row) {
	const source = String(
		(source_or_row && typeof source_or_row === "object"
			? source_or_row.department || source_or_row.cost_center
			: source_or_row) || ""
	).trim();
	if (!source) return "";
	const parts = source
		.split(" - ")
		.map((part) => part.trim())
		.filter(Boolean);
	if (!parts.length) return "";
	const arabic_part = parts.find((part) => ic_is_arabic(part));
	return arabic_part || parts[0];
}

// G-07: the employer file number is read everywhere else with a fixed "1 - "
// prefix (Qiwa, SADAD, the spreadsheet); the page dropped it and printed the
// bare number. An empty file number stays empty rather than becoming a bare
// "1 - ".
function ic_file_no_label(file_no) {
	const value = String(file_no === null || file_no === undefined ? "" : file_no).trim();
	if (!value) return "";
	return `1 - ${value}`;
}

function ic_newest_only(owner, key) {
	owner[key] = (owner[key] || 0) + 1;
	const ticket = owner[key];
	return () => owner[key] === ticket;
}

function ic_error_text(response, fallback) {
	let detail = "";
	try {
		if (response && response._server_messages) {
			detail = JSON.parse(response._server_messages)
				.map((entry) => {
					try {
						return JSON.parse(entry).message;
					} catch (e) {
						return entry;
					}
				})
				.join(" ");
		}
	} catch (e) {
		detail = "";
	}
	if (!detail && response && Array.isArray(response.exc)) detail = response.exc.join(" ");
	return strip_html(detail || "") || fallback;
}

// K-10: bulk_update's failed_docs entry shape is not verifiable against
// installed frappe source in this checkout (client.py is not in this tree),
// so every plausible message property is tried in turn rather than assuming
// one. Returns "" — never undefined — so a caller can filter(Boolean) safely.
function ic_failed_doc_reason(entry) {
	const raw = entry && (entry.exc || entry.error || entry.message);
	if (!raw) return "";
	return strip_html(String(raw)).split("\n")[0];
}

// The Timeline comment IC_ACTIONS' `comment` key writes to, reached the same
// way tools/qiwa-sadad-sync.user.js already calls it in this checkout and
// verified against the installed frappe.desk.form.utils.add_comment signature
// (reference_doctype, reference_name, content, comment_email, comment_by —
// comment_type is fixed to "Comment" inside the endpoint, not a parameter it
// takes). Used where a reason has nowhere left to land on the DocType itself
// and adding a field is not this page's call to make. Fire-and-forget: a lost
// comment does not undo a write bulk_update already reported as succeeded.
function ic_post_comment(row, content) {
	frappe.call({
		method: "frappe.desk.form.utils.add_comment",
		args: {
			reference_doctype: IC_DOCTYPE,
			reference_name: row.name,
			content: content,
			comment_email: frappe.session.user,
			comment_by: frappe.session.user_fullname || frappe.session.user,
		},
		callback: () => {},
		error: () => {},
	});
}

// K-02: the NO branch that used to live here is gone. Rejecting FROM
// "Awaiting Operations Approval" is the reject action below, not a second
// Select value on this one — see IC_ACTIONS "preference" and "reject". This
// function now only ever runs the approval arithmetic.
function ic_preference_patch(row, values) {
	const months = ic_duration_period(values.renewal_duration).months;
	const iqama_fee = IC_IQAMA_FEE[months] || 0;
	const work_permit_fee = cint(row.exempt_compensation)
		? IC_EXEMPT_WORK_PERMIT_FEE
		: IC_WORK_PERMIT_FEE[months] || 0;
	const muqeem_after = flt(row.muqeem_balance) + iqama_fee;

	return {
		renewal_preference: "Yes",
		renewal_duration: values.renewal_duration,
		status: "Awaiting Payment",
		iqama_renewal_amount: iqama_fee,
		work_permit_fee: work_permit_fee,
		total_amount: flt(iqama_fee + work_permit_fee + flt(row.traffic_violation_balance), 2),
		muqeem_balance_after_renewal: row.status === "Renewed" ? flt(row.muqeem_balance) : muqeem_after,
		refundable_balance: muqeem_after > 0 ? 1 : 0,
	};
}

// K-11: the exemption flag drives renewal_duration, and renewal_duration
// drives every fee field ic_preference_patch already computes — so a flip in
// either direction recomputes all of them together, reusing that same
// arithmetic, instead of writing work_permit_fee alone and leaving
// iqama_renewal_amount/total_amount at the previous duration's figures. The
// recompute only runs when the flag actually CHANGES; a save that leaves it
// where it was (e.g. just typing the SADAD number) touches no fee field.
function ic_sadad_patch(row, values) {
	const patch = {
		sadad_invoice: values.sadad_invoice,
		exempt_compensation: cint(values.exempt_compensation),
	};

	const was_exempt = cint(row.exempt_compensation);
	if (patch.exempt_compensation === was_exempt) return patch;

	patch.renewal_duration = patch.exempt_compensation
		? IC_EXEMPT_DURATION
		: row.renewal_duration;

	const months = ic_duration_period(patch.renewal_duration).months;
	const iqama_fee = IC_IQAMA_FEE[months] || 0;
	const work_permit_fee = patch.exempt_compensation
		? IC_EXEMPT_WORK_PERMIT_FEE
		: IC_WORK_PERMIT_FEE[months] || 0;
	const muqeem_after = flt(row.muqeem_balance) + iqama_fee;

	patch.work_permit_fee = work_permit_fee;
	patch.iqama_renewal_amount = iqama_fee;
	patch.total_amount = flt(iqama_fee + work_permit_fee + flt(row.traffic_violation_balance), 2);
	patch.muqeem_balance_after_renewal = row.status === "Renewed" ? flt(row.muqeem_balance) : muqeem_after;
	patch.refundable_balance = muqeem_after > 0 ? 1 : 0;

	return patch;
}

// A default is only safe when every row in the set agrees; a mixed bulk
// selection must open the field unset rather than silently apply one row's
// value to the rest (K-11 point 4).
function ic_common_value(rows, fieldname) {
	if (!rows || !rows.length) return undefined;
	const first = rows[0][fieldname];
	return rows.every((row) => row[fieldname] === first) ? first : undefined;
}

// K-09/K-10 share this test: whether a payment request can still be created
// for a row, over EITHER payment type. One reader of _skip_reason so
// confirm_payment's guard, mark_renewed's guard and the payment-request
// drawer can never disagree about what "still creatable" means.
function ic_pr_still_creatable(row) {
	return Object.keys(IC_PAYMENT_TYPES).some((type) => !ic_skip_reason(row, IC_PAYMENT_TYPES[type], type));
}

// K-09: the one test for "can this row's payment request for this type be
// created". Moved here from ic_actions.js's old prototype method of the same
// name so IC_ACTIONS' blocked_by closures (confirm_payment, mark_renewed,
// cancel_pr) can read it without a `this` receiver — it used no `this`
// internally even as a method, so the move changes nothing about what it
// tests.
function ic_skip_reason(row, config, payment_type) {
	if (cint(row.iqama_renewal_issue)) return t("row_blocked");
	if (row.status !== IC_PAYABLE_STATUS) return t("status_must_be", ic_label(IC_PAYABLE_STATUS));
	if (!IC_ALLOWED_EMPLOYEE_STATUS.includes(row.employee_status)) return t("emp_not_active");
	if (row.pr_status === payment_type || row.pr_status === IC_BOTH) return t("pr_exists");
	if (config.requires_sadad && !row.sadad_invoice) return t("sadad_missing");
	if (flt(row[config.amount_field]) <= 0) return t("amount_zero");
	return null;
}

// K-10: iqama_renewal_tracking.json is not readable from this checkout to
// confirm the DocType's renewal_duration Select options against tabDocField,
// so this reads the SAME client-side meta cache frappe.ui.form itself renders
// a Select from, and falls back to the transcribed IC_DURATION_MONTHS keys
// only when that meta has not been fetched (frappe.meta.get_docfield answers
// undefined until the DocType's meta loads once). Not verified against the
// installed schema in this session — see the round result's DROPPED section.
function ic_duration_options() {
	const docfield =
		frappe.meta && frappe.meta.get_docfield ? frappe.meta.get_docfield(IC_DOCTYPE, "renewal_duration") : null;
	const options = docfield && docfield.options
		? docfield.options.split("\n").map((option) => option.trim()).filter(Boolean)
		: null;
	return options && options.length ? options : Object.keys(IC_DURATION_MONTHS);
}

// ── THE TRANSITION TABLE ─────────────────────────────────────────────────────
//
// One declaration of what a record can be asked to do. The Triage detail bar,
// the Triage bulk bar and the Batch step all read it through ic_legal_actions()
// below, so the rule exists once.
//
// Every `from` list is the status set the ORIGINAL DocType client script guards
// the action with, transcribed from tools/design/TRANSITIONS-FROM-CLIENT-SCRIPT.md.
// Every status string is a value of the DocType's own `status` Select. An empty
// `from` is forbidden here: it is what made "Update SADAD Number" the first
// button on a New record and on a Rejected one alike.
//
// Order is read twice. The first entry a status allows becomes the promoted
// primary button, so the workflow transition is declared before the data-entry
// action that feeds it, and `reject` is declared last so it is never first.
//
// Optional keys:
//   also(row)          widens the guard past `status` for one row
//   blocked_by(row)    the action is legal but cannot run yet; the string is
//                      shown as the disabled entry's tooltip
//   label_for(rows)    the label depends on what the rows already carry
//   comment(row,values) text posted to the record's Timeline via
//                      ic_post_comment after a successful write, for a reason
//                      with no free DocType field to land in — never part of
//                      `patch`, so bulk_update never sees it
const IC_ACTIONS = [
	// F-01: this moves New -> Awaiting Operations Approval. It is a submission
	// into the approval queue, not the approval itself — the approval is
	// "preference" below, guarded on Awaiting Operations Approval.
	{
		name: "approve",
		label: "Send for operations approval",
		from: ["New"],
		patch: () => ({ status: "Awaiting Operations Approval" }),
	},
	// K-02: this used to ask Yes/NO in one Select, duplicating the "reject"
	// action below for the NO branch (renewal_preference is written by
	// subtraction now — see "reject"'s patch). The field list is flat (no
	// depends_on) so this action needs no framework dialog carve-out any more.
	// TRANSITIONS-FROM-CLIENT-SCRIPT.md:9 (pref=Yes branch) and :17
	// (auto:before_save) both authorise Awaiting Payment as this action's
	// resulting status.
	{
		name: "preference",
		label: "Approve Renewal",
		from: ["Awaiting Operations Approval"],
		fields: () => [
			{
				fieldname: "renewal_duration",
				fieldtype: "Select",
				label: t("f_renewal_duration"),
				options: ic_duration_options(),
				reqd: 1,
			},
		],
		patch: ic_preference_patch,
	},
	{
		name: "schedule",
		label: "Schedule for Later",
		from: ["Awaiting Operations Approval"],
		fields: () => [
			{
				fieldname: "reschedule_date",
				fieldtype: "Date",
				label: t("f_reschedule_date"),
				reqd: 1,
			},
		],
		patch: (row, values) => ({
			status: "Rescheduled",
			reschedule_date: values.reschedule_date,
		}),
	},
	// "Rescheduled" was a dead end: nothing in the original moves a record out
	// of it, so the reschedule date passed and the record stayed parked.
	{
		name: "return_to_flow",
		label: "Resume Renewal",
		from: ["Rescheduled"],
		patch: () => ({ status: "Awaiting Operations Approval" }),
	},
	// K-09: this used to hold no guard at all, so a save could pass this record
	// beyond the one status a payment request can be created from before either
	// request existed. blocked_by reuses ic_pr_still_creatable (D8's judgment —
	// NOT pr_status===IC_BOTH, which would strand a zero-amount row that can
	// never reach IC_BOTH). TRANSITIONS-FROM-CLIENT-SCRIPT.md:13 authorises
	// Awaiting Renewal as this action's resulting status.
	{
		name: "confirm_payment",
		label: "Confirm Payment",
		from: ["Awaiting Payment"],
		blocked_by: (row) => (ic_pr_still_creatable(row) ? t("pr_still_creatable") : null),
		patch: () => ({ status: "Awaiting Renewal" }),
	},
	// The SADAD number only feeds the work-card payment request, and that
	// request is only offered at "Awaiting Payment", so that is the one status
	// where entering the number can change anything.
	{
		name: "sadad",
		label: "Update SADAD Number",
		from: ["Awaiting Payment"],
		label_for: (rows) =>
			rows.every((row) => row.sadad_invoice) ? "Update SADAD Number" : "Enter SADAD Number",
		// K-11 point 3/4: a default is offered only when every picked row
		// agrees (ic_common_value) — a mixed bulk selection opens unset rather
		// than silently applying one row's value to the rest.
		fields: (rows) => [
			{
				fieldname: "sadad_invoice",
				fieldtype: "Data",
				label: t("sadad_number"),
				reqd: 1,
				default: ic_common_value(rows, "sadad_invoice"),
			},
			{
				fieldname: "exempt_compensation",
				fieldtype: "Check",
				label: t("f_exempt"),
				default: ic_common_value(rows, "exempt_compensation"),
				description: t("exempt_hint"),
			},
		],
		patch: (row, values) => ic_sadad_patch(row, values),
	},
	// K-09: reuses the same ic_pr_still_creatable this round adds to
	// confirm_payment, replacing the old pr_status===IC_BOTH test that
	// stranded a zero-amount-fee row here forever (it can never reach IC_BOTH,
	// so its own missing fee blocked confirmation of a renewal nothing further
	// was owed on). Nothing anywhere moved a record to "Renewed" in the
	// original — see TRANSITIONS-FROM-CLIENT-SCRIPT.md gap:mark_renewed.
	{
		name: "mark_renewed",
		label: "Confirm Renewal",
		from: ["Awaiting Renewal"],
		blocked_by: (row) => (ic_pr_still_creatable(row) ? t("pr_missing") : null),
		fields: () => [
			{
				fieldname: "iqama_new_expiration_date",
				fieldtype: "Date",
				label: t("f_new_expiration_date"),
				reqd: 1,
			},
		],
		patch: (row, values) => ({
			status: "Renewed",
			iqama_new_expiration_date: values.iqama_new_expiration_date,
		}),
	},
	// K-09: payment was a one-way door — no action cleared pr_status or either
	// reference field, so a mistaken request could never be undone from this
	// page. Touches no `status` field at all (pr_status is a separate
	// dimension from the state machine TRANSITIONS-FROM-CLIENT-SCRIPT.md
	// describes), so it needs no line-number citation there; `from` is the
	// same two statuses a request can exist under. `cancel_reason` is
	// transient like resolve_issue's `resolution` field above — it never
	// reaches `patch`, only `comment`, since iqama_renewal_tracking.json
	// still has no free field for it and adding one is not this page's call
	// to make; it lands on the record's Timeline instead.
	{
		name: "cancel_pr",
		label: "Cancel Payment Request",
		from: ["Awaiting Payment", "Awaiting Renewal"],
		blocked_by: (row) => (row.pr_status ? null : t("pr_none_to_cancel")),
		fields: () => [
			{
				fieldname: "cancel_reason",
				fieldtype: "Small Text",
				label: t("f_reason"),
				reqd: 1,
			},
		],
		patch: () => ({
			pr_status: "",
			pr_reference: "",
			pr_reference_2: "",
		}),
		comment: (row, values) => values.cancel_reason,
	},
	// No action set "Issue Preventing Renewal", so a record that hit a real
	// obstacle could only be rejected.
	{
		name: "flag_issue",
		label: "Report an Issue",
		from: ["Awaiting Payment", "Awaiting Renewal"],
		fields: () => [
			{
				fieldname: "reason_of_preventing_renewal",
				fieldtype: "Small Text",
				label: t("f_preventing_reason"),
				reqd: 1,
			},
		],
		patch: (row, values) => ({
			status: "Issue Preventing Renewal",
			iqama_renewal_issue: 1,
			reason_of_preventing_renewal: values.reason_of_preventing_renewal,
		}),
	},
	// The exit D-21 asks for. `also` carries the second half of the guard: a row
	// can hold the issue flag while its status still reads something else, and
	// that row is blocked everywhere else in the page for exactly that reason.
	// The resolution is appended to the blocking reason rather than written over
	// it, because the DocType has no separate resolution field and the reason
	// the record was blocked is the thing an auditor asks for later.
	{
		name: "resolve_issue",
		label: "Resolve Issue",
		from: ["Issue Preventing Renewal"],
		also: (row) => Boolean(cint(row.iqama_renewal_issue)),
		fields: () => [
			{
				fieldname: "resolution",
				fieldtype: "Small Text",
				label: t("f_resolution"),
				reqd: 1,
			},
		],
		patch: (row, values) => {
			const note = String(values.resolution || "").trim();
			const before = String(row.reason_of_preventing_renewal || "").trim();
			return {
				status: row.pr_status === IC_BOTH ? "Awaiting Renewal" : "Awaiting Payment",
				iqama_renewal_issue: 0,
				reason_of_preventing_renewal: before ? `${before}\nRESOLVED: ${note}` : `RESOLVED: ${note}`,
			};
		},
	},
	// "Rejected" was the other dead end. 738 records sit in it.
	{
		name: "reopen",
		label: "Reopen Request",
		from: ["Rejected"],
		patch: () => ({ status: "Awaiting Operations Approval" }),
	},
	// K-32: "Waiting for Legal Approval" had no forward exit on this page — the
	// DocType form still advances it (auto:legal_to_payment), but an operator
	// working only from here could not. Same guard and effect as that auto
	// trigger, offered as an explicit action instead.
	// TRANSITIONS-FROM-CLIENT-SCRIPT.md:16 authorises Awaiting Payment here.
	{
		name: "confirm_legal",
		label: "Confirm Legal Approval",
		from: ["Waiting for Legal Approval"],
		fields: () => [
			{
				fieldname: "contract_date",
				fieldtype: "Date",
				label: t("f_contract_date"),
				reqd: 1,
			},
		],
		patch: (row, values) => ({
			status: "Awaiting Payment",
			contract_date: values.contract_date,
		}),
	},
	// The exit for a final departure or a transfer of sponsorship — distinct
	// from "reject", which declines a renewal still in progress. `from` copies
	// "reject"'s own list below rather than a fresh guess: TRANSITIONS-FROM-
	// CLIENT-SCRIPT.md names no authority for this action since it did not
	// exist in the original, so the same non-terminal statuses reject is
	// offered from is the nearest authorised set, and it excludes every
	// terminal/settled status by construction. Declared just before reject so
	// neither is ever the promoted button and neither is offered on a record
	// already settled; every status-changing action above this point is
	// declared earlier and keeps its own promotion. The reason is required and
	// captured as a Timeline comment via `comment`, not written into
	// reason_of_not_renew: that field's own meaning is "why a renewal was not
	// renewed" (TRANSITIONS-FROM-CLIENT-SCRIPT.md:18 ties it to the reject
	// path), and a final-exit reason is not a rejection reason.
	{
		name: "stop_renewal",
		label: "Stop Renewal",
		from: [
			"New",
			"Awaiting Operations Approval",
			"Rescheduled",
			"Waiting for Legal Approval",
			"Awaiting Payment",
			"Awaiting Renewal",
			"Issue Preventing Renewal",
		],
		fields: () => [
			{
				fieldname: "stop_reason",
				fieldtype: "Small Text",
				label: t("f_reason"),
				reqd: 1,
			},
		],
		patch: () => ({ status: "Renewal Stopped" }),
		comment: (row, values) => values.stop_reason,
	},
	// Declared last so it is never the promoted button, and never offered on a
	// record that is already settled. The reason is required: the original wrote
	// the status and nothing else, which is why 738 rejections carry no cause.
	// K-02: renewal_preference:"NO" is written here now too, so rejecting
	// through this one button is the ONLY path to "Rejected" from Awaiting
	// Operations Approval — no second copy of the transition differs on this
	// field any more. TRANSITIONS-FROM-CLIENT-SCRIPT.md:9 (pref=No branch) and
	// :14 (reject_renewal) both authorise Rejected as this action's result.
	{
		name: "reject",
		label: "Reject Renewal",
		from: [
			"New",
			"Awaiting Operations Approval",
			"Rescheduled",
			"Waiting for Legal Approval",
			"Awaiting Payment",
			"Awaiting Renewal",
			"Issue Preventing Renewal",
		],
		fields: () => [
			{
				fieldname: "reason_of_not_renew",
				fieldtype: "Small Text",
				label: t("f_reason_not_renew"),
				reqd: 1,
			},
		],
		patch: (row, values) => ({
			status: "Rejected",
			renewal_preference: "NO",
			reason_of_not_renew: values.reason_of_not_renew,
		}),
	},
];

// K-06: "iq 2" (Before Save, Iqama Renewal Tracking, not in this tree) can
// rewrite ANY save's status to Rejected when the employee is not Active —
// re-checked live at save time. This cannot close that hole (the root cause
// is server-side — see the round result), but it refuses every transition
// up front for a row this page already knows carries a disallowed employee
// status, rather than let the write land and misreport as applied.
function ic_action_allows(action, row) {
	if (!IC_ALLOWED_EMPLOYEE_STATUS.includes(row.employee_status)) return false;
	if (action.from.includes(row.status)) return true;
	return Boolean(action.also && action.also(row));
}

// The one answer to "which actions are legal here", called by the Triage detail
// bar, the Triage bulk bar and the Batch step. A set of rows gets the
// INTERSECTION of what its rows allow — every selected row must permit the
// action — so a mixed-status selection collapses to what they share, and a
// selection sharing no transition offers nothing rather than something wrong.
//
// It returns copies, never the table's own entries: the label and the disabled
// state depend on the rows being asked about, and the table must not carry the
// answer to one question into the next.
function ic_legal_actions(rows, can_write) {
	if (!can_write || !rows || !rows.length) return [];

	return IC_ACTIONS.filter((action) => rows.every((row) => ic_action_allows(action, row))).map(
		(action) => {
			const reason = action.blocked_by
				? rows.map((row) => action.blocked_by(row)).find(Boolean) || ""
				: "";
			return Object.assign({}, action, {
				label: action.label_for ? action.label_for(rows) : action.label,
				disabled: Boolean(reason),
				reason: reason,
			});
		}
	);
}

// D-23: the two payment requests are named after the flag they set, in the past
// tense. The flag value stays — it is written to pr_status — but the button
// asks for the payment instead of announcing it.
const IC_PR_ACTION_KEY = {
	"PR Created for Work Cards": "act_pr_work_card",
	"PR Created for Iqama Renewal": "act_pr_iqama",
};

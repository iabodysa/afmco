// Copyright (c) 2026, AFMCO and contributors

const IC_RTL_LANGS = ["ar", "he", "fa", "ur"];

const IC_RAW_LANG = (frappe.boot && frappe.boot.lang) || navigator.language || "en";
const IC_LANG = String(IC_RAW_LANG).split("-")[0].toLowerCase();
const IC_IS_RTL = IC_RTL_LANGS.includes(IC_LANG);
const IC_DIR = IC_IS_RTL ? "rtl" : "ltr";
// The "what happens next" and history rows join an action to its resulting
// status with an arrow between two Arabic runs. A fixed glyph reads backwards
// once the runs around it flow right-to-left, so the glyph itself flips with
// direction the same way IC_DIR does, from this one source.
const IC_FLOW_ARROW = IC_IS_RTL ? "←" : "→";

// Latin digits everywhere. Operations staff read every upstream system — Qiwa,
// SADAD, the spreadsheet — in Latin digits and transcribe between them.
const IC_DATA_LOCALE = IC_IS_RTL ? "ar-SA-u-nu-latn" : "en";

const IC_STR = {
	page_title: __("Iqama Control", null, "Iqama Control"),
	page_title_long: __("Iqama Renewal Control", null, "Iqama Control"),
	open_count: __("{0} records", null, "Iqama Control"),
	actions: __("Actions", null, "Iqama Control"),
	queue_after_step: __("Queue after this step", null, "Iqama Control"),
	all_statuses: __("All Statuses", null, "Iqama Control"),
	scope_all: __("All records", null, "Iqama Control"),
	scope_quarter: __("Last 60 days", null, "Iqama Control"),
	scope_day: __("Last day", null, "Iqama Control"),
	more_filters: __("More filters", null, "Iqama Control"),
	f_corporation: __("Corporation", null, "Iqama Control"),
	f_department: __("Department", null, "Iqama Control"),
	f_cost_center: __("Cost center", null, "Iqama Control"),
	f_dept_cost_center: __("Department / Cost center", null, "Iqama Control"),
	f_employee: __("Employee", null, "Iqama Control"),
	search_employee_number: __("Search by employee number", null, "Iqama Control"),
	f_expiry_to: __("Expiring before", null, "Iqama Control"),
	f_lens: __("Show", null, "Iqama Control"),
	f_with_sadad: __("With SADAD only", null, "Iqama Control"),
	f_include_settled: __("Include settled", null, "Iqama Control"),
	f_recent_minutes: __("Updated in the last (minutes)", null, "Iqama Control"),
	f_renewal_duration: __("Renewal Duration", null, "Iqama Control"),
	f_reason_not_renew: __("Reason of Not Renewal", null, "Iqama Control"),
	f_reschedule_date: __("Select reschedule date", null, "Iqama Control"),
	f_exempt: __("Exempt from Financial Compensation", null, "Iqama Control"),
	f_preventing_reason: __("Reason preventing renewal", null, "Iqama Control"),
	f_resolution: __("How was the issue resolved", null, "Iqama Control"),
	f_new_expiration_date: __("New iqama expiration date", null, "Iqama Control"),
	f_reason: __("Reason", null, "Iqama Control"),
	expiry_state: __("Expiry status", null, "Iqama Control"),
	overdue_days: __("{0} days overdue", null, "Iqama Control"),
	due_in_days: __("Due in {0} days", null, "Iqama Control"),
	due_today: __("Due today", null, "Iqama Control"),
	due: __("Due", null, "Iqama Control"),
	amount_due: __("Amount due now", null, "Iqama Control"),
	sadad_number: __("SADAD number", null, "Iqama Control"),
	blocked: __("Blocked", null, "Iqama Control"),
	block_reason: __("Blocking reason", null, "Iqama Control"),
	inactive: __("Inactive", null, "Iqama Control"),
	no_sadad: __("No SADAD", null, "Iqama Control"),
	not_captured: __("not captured", null, "Iqama Control"),
	not_calculated: __("Not calculated", null, "Iqama Control"),
	nitaqat: __("Nitaqat", null, "Iqama Control"),
	nitaqat_v: __("Nitaqat: {0}", null, "Iqama Control"),
	flagged_n: __("Flagged ({0})", null, "Iqama Control"),
	open: __("Open", null, "Iqama Control"),
	history: __("History", null, "Iqama Control"),
	history_n: __("History ({0} events)", null, "Iqama Control"),
	history_empty: __("No recorded change.", null, "Iqama Control"),
	comment: __("Comment", null, "Iqama Control"),
	created: __("Created", null, "Iqama Control"),
	cancel: __("Cancel", null, "Iqama Control"),
	confirm: __("Confirm", null, "Iqama Control"),
	field_required: __("This field is required.", null, "Iqama Control"),
	records: __("Records", null, "Iqama Control"),
	rows: __("Rows", null, "Iqama Control"),
	loading: __("Loading…", null, "Iqama Control"),
	retry: __("Retry", null, "Iqama Control"),
	refresh: __("Refresh", null, "Iqama Control"),
	back: __("Back", null, "Iqama Control"),
	update: __("Update", null, "Iqama Control"),
	copy: __("Copy", null, "Iqama Control"),
	select: __("Select", null, "Iqama Control"),
	skipped: __("Skipped", null, "Iqama Control"),
	updated_records: __("Updated records", null, "Iqama Control"),
	payment_request: __("Payment Request", null, "Iqama Control"),
	list_empty: __("No records match these filters.", null, "Iqama Control"),
	detail_empty: __("Pick a record.", null, "Iqama Control"),
	step_empty: __("Nothing at this step.", null, "Iqama Control"),
	today_empty: __("Nothing waiting on you today.", null, "Iqama Control"),
	review_only_step: __("Review only", null, "Iqama Control"),
	show_all_records: __("Show all records", null, "Iqama Control"),
	showing_of: __("Showing {0} of {1}", null, "Iqama Control"),
	needs_today: __("Needs action today", null, "Iqama Control"),
	chart_empty: __("No expiry dates to plot.", null, "Iqama Control"),
	chart_status: __("Distribution by status ({0})", null, "Iqama Control"),
	sort_expiry: __("Sort: Expiry", null, "Iqama Control"),
	sort_project: __("Sort: Department", null, "Iqama Control"),
	nothing_to_share: __("Nothing to share out.", null, "Iqama Control"),
	whats_next: __("What happens next", null, "Iqama Control"),
	count_suffix: __("{0} ({1})", null, "Iqama Control"),
	checked_of: __("{0} of {1} checked", null, "Iqama Control"),
	select_all_n: __("Select all {0}", null, "Iqama Control"),
	select_all_loaded: __("Select all loaded", null, "Iqama Control"),
	bulk_selected: __("{0} selected", null, "Iqama Control"),
	bulk_clear: __("Clear selection", null, "Iqama Control"),
	select_all: __("Select all", null, "Iqama Control"),
	more_actions: __("More", null, "Iqama Control"),
	status_filter: __("Status", null, "Iqama Control"),
	bulk_cap: __("Only {0} records can be moved at once.", null, "Iqama Control"),
	deselect_hint: __("Deselect records to exclude", null, "Iqama Control"),
	and_more: __("and {0} more", null, "Iqama Control"),
	applying: __("{0}…", null, "Iqama Control"),
	creating_pr: __("Creating payment request…", null, "Iqama Control"),
	select_one: __("Select at least one record.", null, "Iqama Control"),
	nothing_to_copy: __("Nothing to copy.", null, "Iqama Control"),
	copy_manually: __("Copy manually", null, "Iqama Control"),
	copy_recent: __("Copy recent updates", null, "Iqama Control"),
	copy_selected: __("Copy selected rows", null, "Iqama Control"),
	load_failed_title: __("Could not load the board", null, "Iqama Control"),
	load_failed_reason: __("The board could not be loaded. The reason is shown below.", null, "Iqama Control"),
	bulk_failed: __("The records were not moved.", null, "Iqama Control"),
	not_updated_n: __("{0} of {1} not updated.", null, "Iqama Control"),
	pr_exists: __("A payment request already exists for this type.", null, "Iqama Control"),
	pr_failed: __("The payment request was not created.", null, "Iqama Control"),
	pr_none_eligible: __("No eligible record. Nothing was created.", null, "Iqama Control"),
	row_blocked: __("Renewal is blocked on this record.", null, "Iqama Control"),
	pr_missing: __("Both payment requests must exist first.", null, "Iqama Control"),
	emp_not_active: __("Employee is not Active.", null, "Iqama Control"),
	sadad_missing: __("SADAD number is missing.", null, "Iqama Control"),
	amount_zero: __("Amount is zero.", null, "Iqama Control"),
	status_must_be: __("Status must be {0}.", null, "Iqama Control"),
	act_pr_work_card: __("Create work permit payment request", null, "Iqama Control"),
	act_pr_iqama: __("Create iqama renewal payment request", null, "Iqama Control"),
	act_copy_row: __("Copy row", null, "Iqama Control"),
	pr_row_work_card: __("Work permit", null, "Iqama Control"),
	pr_row_iqama: __("Iqama renewal", null, "Iqama Control"),
	record_n_of_m: __("Record {0} of {1}", null, "Iqama Control"),
	prev_record: __("Previous record", null, "Iqama Control"),
	next_record: __("Next record", null, "Iqama Control"),
	key_select: __("Select this record", null, "Iqama Control"),
	shortcuts: __("Keyboard shortcuts", null, "Iqama Control"),
	toast_sadad_saved: __("SADAD number saved", null, "Iqama Control"),
	toast_pr_created: __("Payment request {0} created", null, "Iqama Control"),
	toast_rejected: __("Renewal rejected", null, "Iqama Control"),
	toast_copied: __("Row copied", null, "Iqama Control"),
	toast_copied_n: __("Copied {0} row(s). Paste into Excel.", null, "Iqama Control"),
	days_col: __("Days", null, "Iqama Control"),
	missing_fees: __("Missing fees", null, "Iqama Control"),
	fees_missing: __("Fees not calculated", null, "Iqama Control"),
	history_head: __("History — {0} events, last {1}", null, "Iqama Control"),
	undo: __("Undo", null, "Iqama Control"),
	undone: __("Change undone", null, "Iqama Control"),
	undo_failed: __("The change was not undone.", null, "Iqama Control"),
	toast_applied: __("{0} — {1} record(s) updated", null, "Iqama Control"),
	needs_intervention: __("Needs intervention", null, "Iqama Control"),
	intervention_sub: __("Rescheduled or blocked", null, "Iqama Control"),
	hijri_date: __("Umm al-Qura", null, "Iqama Control"),
	no_expiry: __("No expiry date", null, "Iqama Control"),
	chart_overdue: __("Overdue distribution", null, "Iqama Control"),
	load_more: __("Load {0} more", null, "Iqama Control"),
	narrow_filters: __("Narrow the filters to reach the rest.", null, "Iqama Control"),
	rows_truncated: __("Showing the first {0} records — narrow the filters to see the rest.", null, "Iqama Control"),
	share_of: __("{0}% of {1}", null, "Iqama Control"),
	money_committing: __("Committing", null, "Iqama Control"),
	money_of_step: __("of {0} at this step", null, "Iqama Control"),
	chart_dimension: __("Distribution by {0} ({1})", null, "Iqama Control"),
	of_dated_records: __("of records carrying an expiry date", null, "Iqama Control"),
	narrowed_by: __("Counted over", null, "Iqama Control"),
	yes: __("Yes", null, "Iqama Control"),
	other_statuses: __("Other ({0})", null, "Iqama Control"),
	open_full_list: __("Open the full list", null, "Iqama Control"),
	ready_of: __("{0} of {1} ready — the rest are blocked or missing fees", null, "Iqama Control"),
	duplicate: __("Duplicate", null, "Iqama Control"),
	duplicate_hint: __("Another open record exists for this employee", null, "Iqama Control"),
	clear_risk: __("Clear the expiry filter", null, "Iqama Control"),
	clear_search: __("Clear search", null, "Iqama Control"),
	clear_project: __("Clear", null, "Iqama Control"),
	clear_fees: __("Show every record", null, "Iqama Control"),
	restore_filters: __("Restore filters", null, "Iqama Control"),
	search_widened_filters: __("Search widened {0} filters", null, "Iqama Control"),
	show_all_statuses: __("Show all statuses", null, "Iqama Control"),
	status_diverged_n: __("{0} record(s) saved but the status returned does not match what this action requested — treat as unresolved.", null, "Iqama Control"),
	pr_still_creatable: __("A payment request can still be created for this record.", null, "Iqama Control"),
	pr_none_to_cancel: __("No payment request exists to cancel.", null, "Iqama Control"),
	f_contract_date: __("Contract date", null, "Iqama Control"),
	pr_payee: __("Payee", null, "Iqama Control"),
	pr_eligible_total: __("{0} eligible — {1}", null, "Iqama Control"),
	pr_sibling_warning_n: __("{0} record(s) may already have an open sibling request", null, "Iqama Control"),
	pr_unlinked_n: __("{0} record(s) were not linked to {1} — link them there, do not re-request", null, "Iqama Control"),
	pr_cancel_hint: __("This request can be cancelled later from the record's Cancel Payment Request action.", null, "Iqama Control"),
	close: __("Close", null, "Iqama Control"),
	exempt_hint: __("Changes duration to {0} and recalculates every fee.", null, "Iqama Control"),
	employee_expiry_stale_n: __("{0} Employee record(s) still show the old iqama expiry after this renewal", null, "Iqama Control"),
	employee_expiry_still: __("still shows {0}", null, "Iqama Control"),
};

// Labels that reach the view inside a variable rather than as a literal: the
// DocType's own status values, the payment-request flags it writes, and the
// English labels the config tables carry. Keyed by the exact English value.
// English display overrides. Every other English label falls through
// ic_label()'s own String(value) fallback (mechanism note at the top of
// this file), which is exact for everything except the five entries
// below — the stored DocType status value is kept exactly as written
// (K-36 owner ruling, round 11), only what the operator SEES changes.
// "Awaiting payment" (IC_TILES, ic_config.js) is a second, differently
// cased rendering of the same "Awaiting Payment" status on the dashboard
// KPI tile; it is mapped here too so that tile does not go on showing the
// old wording while every rail row, filter option, chip and list cell
// switches to the new one.
const IC_LABEL_EN = {
	"Awaiting Operations Approval": "Pending Operations Approval",
	"Waiting for Legal Approval": "Pending Legal Approval",
	"Awaiting Payment": "Pending Payment",
	"Awaiting Renewal": "Pending Renewal",
	"Issue Preventing Renewal": "Renewal Blocking Issue",
	"Awaiting payment": "Pending Payment",
	"Renewal Stopped": "Renewal Stopped",
};


function ic_fill(template, args) {
	return String(template).replace(/\{(\d+)\}/g, (match, index) => {
		const value = args[cint(index)];
		return value === undefined || value === null ? "" : String(value);
	});
}

function t(key, ...args) {
	return ic_fill(IC_STR[key] || key, args);
}

function ic_label(value) {
	if (value === null || value === undefined || value === "") return "";
	return (!IC_IS_RTL && IC_LABEL_EN[value]) || __(String(value), null, "Iqama Control");
}

// Latin digits in Arabic flow. Intl with a bare "ar-SA" emits the Arabic-Indic
// digit set, which does not match Qiwa, SADAD or the spreadsheet the operator
// reads beside this page. The -u-nu-latn extension forces the Latin set.
const IC_NUM_FORMAT = new Intl.NumberFormat(IC_DATA_LOCALE);

function ic_count(value) {
	return IC_NUM_FORMAT.format(cint(value));
}

// D-09: a count the page has not obtained yet, or whose query failed, is not a
// zero. Every renderer of a server count reads it through here, so a number
// nobody measured never appears as one somebody did.
function ic_count_or_wait(value) {
	return value === null || value === undefined ? "\u2014" : ic_count(value);
}

// ── D-14 and D-15: one formatter per thing this page renders ─────────────────
//
// Nothing below concatenates a date or an amount by hand and nothing renders
// seconds. Three facts from the installed framework decide the shape:
//
//  1. frappe.boot.time_zone is an OBJECT, {system, user} — not a string
//     (apps/frappe/frappe/public/js/frappe/utils/datetime.js,
//     convert_to_user_tz). Intl's timeZone option wants a string, so the user
//     zone is read off that object and only ever used as a name.
//  2. The database holds every datetime in the SYSTEM zone. The framework's
//     convert_to_user_tz() does the zone arithmetic with moment-timezone and
//     answers a wall clock in the USER zone, so this page never repeats it.
//     frappe.datetime.now_datetime() is already a USER-zone wall clock.
//  3. A wall clock is not an instant. Each one is turned into an instant by
//     reading its fields as UTC, and every formatter here renders in UTC, so
//     the same wall clock comes back with no second shift.
//
// A bare "ar-SA" resolves to BOTH the Umm al-Qura calendar and the
// Arabic-Indic digit set, so the Gregorian formatter names its calendar and
// every locale here names -nu-latn. That is I18N-04 in one place.

// No zone name is held here on purpose. The brief's snippet reads
// frappe.boot.time_zone straight into Intl's timeZone option, and that option
// wants a string where frappe.boot.time_zone is an object — it would throw a
// RangeError out of every formatter on this page. The zone is applied by
// convert_to_user_tz() instead, and these formatters render in UTC so they do
// not apply it a second time.
const IC_GREG_LOCALE = IC_IS_RTL ? "ar-SA-u-ca-gregory-nu-latn" : "en";
const IC_HIJRI_LOCALE = IC_IS_RTL ? "ar-SA-u-ca-islamic-umalqura-nu-latn" : "en-u-ca-islamic-umalqura";

// A browser that rejects a Unicode extension throws RangeError out of the
// constructor, which would take the whole module down at load. Every formatter
// is built through here so a rejected locale costs its own formatting only.
function ic_date_format(locale, options) {
	try {
		return new Intl.DateTimeFormat(locale, options);
	} catch (error) {
		try {
			return new Intl.DateTimeFormat("en", options);
		} catch (inner) {
			return null;
		}
	}
}

const IC_FMT_DATETIME = ic_date_format(IC_GREG_LOCALE, {
	dateStyle: "medium",
	timeStyle: "short",
	timeZone: "UTC",
});
const IC_FMT_DATE = ic_date_format(IC_GREG_LOCALE, { dateStyle: "medium", timeZone: "UTC" });
const IC_FMT_HIJRI = ic_date_format(IC_HIJRI_LOCALE, { dateStyle: "long", timeZone: "UTC" });

const IC_REL = (function () {
	try {
		return new Intl.RelativeTimeFormat(IC_DATA_LOCALE, { numeric: "auto" });
	} catch (error) {
		return null;
	}
})();

// One rendering of an amount for the whole page. The detail panel wrote the
// symbol before the number and the dashboard wrote it after, because each
// reached for a different helper; both now reach for this one.
//
// R8-B item 5: Intl's own {style:"currency", currency:"SAR"} was measured
// against this exact locale (node -e with Intl.NumberFormat("ar-SA-u-nu-latn",
// {style:"currency", currency:"SAR", ...}).format(1234.5)) and returns
// "‏1,234.50 ر.س.‏" — a RIGHT-TO-LEFT MARK (U+200F)
// wrapped around the whole string, and the ICU Arabic abbreviation for SAR is
// itself "ر.س." (r-dot-s-dot), which is where the trailing dot the
// owner saw comes from. Neither is a rendering accident this page can isolate
// away with CSS alone, because both are inside the formatted string. The
// digits are formatted through Intl exactly as before (decimal style, 2
// fixed places, Latin numerals from IC_DATA_LOCALE's -u-nu-latn), then any
// stray bidi control character is stripped, then ONE fixed, dot-free symbol
// is appended on the same side ICU used (after the amount in Arabic, before
// it in English) so every call site — list, detail panel, dashboard — that
// already calls ic_money()/IC_FMT_SAR.format() keeps doing so unchanged and
// gets byte-identical output for the same amount.
const IC_FMT_SAR_DIGITS = (function () {
	const options = { minimumFractionDigits: 2, maximumFractionDigits: 2 };
	try {
		return new Intl.NumberFormat(IC_DATA_LOCALE, options);
	} catch (error) {
		return new Intl.NumberFormat("en", options);
	}
})();

// U+200E LEFT-TO-RIGHT MARK, U+200F RIGHT-TO-LEFT MARK, U+061C ARABIC LETTER
// MARK — the three invisible bidi controls Intl's currency style is free to
// emit around the symbol. None carries meaning once the symbol is fixed text.
// Written as escapes, not the literal characters, so no invisible byte sits
// in this source file.
const IC_BIDI_MARKS = /[\u200e\u200f\u061c]/g;

const IC_SAR_SYMBOL = __("SAR", null, "Iqama Control");

const IC_FMT_SAR = {
	format(value) {
		const digits = IC_FMT_SAR_DIGITS.format(value).replace(IC_BIDI_MARKS, "");
		return IC_IS_RTL ? `${digits} ${IC_SAR_SYMBOL}` : `${IC_SAR_SYMBOL} ${digits}`;
	},
};

const IC_STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

function ic_instant(value) {
	const parts = IC_STAMP.exec(String(value === null || value === undefined ? "" : value).trim());
	if (!parts) return null;
	const at = Date.UTC(
		Number(parts[1]),
		Number(parts[2]) - 1,
		Number(parts[3]),
		Number(parts[4] || 0),
		Number(parts[5] || 0),
		Number(parts[6] || 0)
	);
	return Number.isNaN(at) ? null : new Date(at);
}

// A Date field carries no time and therefore no zone: it is the same day in
// every zone and must not be shifted. Only a value carrying a clock is passed
// through the framework's zone conversion.
function ic_user_instant(value) {
	const text = String(value === null || value === undefined ? "" : value);
	if (text.indexOf(" ") < 0 && text.indexOf("T") < 0) return ic_instant(text);
	try {
		if (frappe.datetime && frappe.datetime.convert_to_user_tz) {
			return ic_instant(frappe.datetime.convert_to_user_tz(text));
		}
	} catch (error) {
		return ic_instant(text);
	}
	return ic_instant(text);
}

function ic_now_wall() {
	try {
		if (frappe.datetime && frappe.datetime.now_datetime) {
			const at = ic_instant(frappe.datetime.now_datetime());
			if (at) return at;
		}
	} catch (error) {
		return new Date();
	}
	return new Date();
}

function ic_datetime(value) {
	const at = ic_user_instant(value);
	return at && IC_FMT_DATETIME ? IC_FMT_DATETIME.format(at) : "";
}

function ic_date(value) {
	const at = ic_instant(value);
	return at && IC_FMT_DATE ? IC_FMT_DATE.format(at) : "";
}

function ic_hijri(value) {
	const at = ic_instant(value);
	if (!at || !IC_FMT_HIJRI) return "";
	try {
		return IC_FMT_HIJRI.format(at);
	} catch (error) {
		return "";
	}
}

const IC_REL_STEPS = [
	{ unit: "year", ms: 31536000000 },
	{ unit: "month", ms: 2592000000 },
	{ unit: "week", ms: 604800000 },
	{ unit: "day", ms: 86400000 },
	{ unit: "hour", ms: 3600000 },
	{ unit: "minute", ms: 60000 },
];

// "12 days ago" with the full timestamp kept for the title attribute. Both
// sides of the subtraction are the same kind of value — a user-zone wall clock
// read as UTC — so the gap is the real one.
function ic_since(value) {
	const at = ic_user_instant(value);
	if (!at) return "";
	if (!IC_REL) return ic_datetime(value);

	const gap = at.getTime() - ic_now_wall().getTime();
	const size = Math.abs(gap);
	for (let index = 0; index < IC_REL_STEPS.length; index++) {
		const step = IC_REL_STEPS[index];
		if (size >= step.ms) return IC_REL.format(Math.round(gap / step.ms), step.unit);
	}
	return IC_REL.format(0, "second");
}

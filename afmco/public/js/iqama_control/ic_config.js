// Copyright (c) 2026, AFMCO and contributors

const IC_DOCTYPE = "Iqama Renewal Tracking";
const IC_EXPENSE_DOCTYPE = "Payment Requisition";
const IC_ROW_LIMIT = 500;

const IC_VIEWS = [
	{ key: "triage", label: "Triage" },
	{ key: "dashboard", label: "Dashboard" },
	{ key: "batch", label: "Batch" },
];

const IC_STATUSES = [
	"New",
	"Awaiting Operations Approval",
	"Rescheduled",
	"Waiting for Legal Approval",
	"Awaiting Payment",
	"Awaiting Renewal",
	"Issue Preventing Renewal",
	"Renewed",
	"Rejected",
	"Renewal Stopped",
];

// A11Y-02: four semantic tones carry every status on the page, in place of the
// ten decorative colour names the DocType list view uses. Ten hues told the
// operator nothing — two of them were the same blue — and colour was the only
// channel, so the rail was unreadable to anyone who cannot separate red from
// green. Each tone is paired with a SHAPE on the rail dot and with the status
// text itself, so the surface survives a greyscale screenshot.
//
//   critical   blocked, rejected, or an expiry already past
//   attention  waiting on THIS user to do something
//   done       finished
//   neutral    waiting on someone else
const IC_TONE_CRITICAL = "critical";
const IC_TONE_ATTENTION = "attention";
const IC_TONE_DONE = "done";
const IC_TONE_NEUTRAL = "neutral";

const IC_STATUS_TONE = {
	"New": IC_TONE_ATTENTION,
	"Awaiting Operations Approval": IC_TONE_ATTENTION,
	"Rescheduled": IC_TONE_NEUTRAL,
	"Waiting for Legal Approval": IC_TONE_NEUTRAL,
	"Awaiting Payment": IC_TONE_ATTENTION,
	"Awaiting Renewal": IC_TONE_NEUTRAL,
	"Issue Preventing Renewal": IC_TONE_CRITICAL,
	"Renewed": IC_TONE_DONE,
	"Rejected": IC_TONE_CRITICAL,
	"Renewal Stopped": IC_TONE_CRITICAL,
};

function ic_status_tone(status) {
	return IC_STATUS_TONE[status] || IC_TONE_NEUTRAL;
}

// D-25: these are QUEUES, not a sequence. The numbered six-circle stepper drew
// a straight line New -> Done and had nowhere to put Rescheduled, Issue
// Preventing Renewal or Rejected, which are branches — and are exactly the
// records a person has to look at. Nothing here is numbered and nothing is
// drawn behind or ahead of anything else; the count inside a card is the whole
// payload.
//
// `statuses` is a list because one card can stand for more than one status.
// The intervention card is the reason: it is the only route from the Batch view
// to a Rescheduled or a blocked record.
const IC_STEPS = [
	{ key: "new", label: "New", statuses: ["New"] },
	{ key: "ops", label: "Ops approval", statuses: ["Awaiting Operations Approval"] },
	{ key: "legal", label: "Legal", statuses: ["Waiting for Legal Approval"] },
	{ key: "payment", label: "Payment", statuses: ["Awaiting Payment"] },
	{ key: "renewal", label: "Renewal", statuses: ["Awaiting Renewal"] },
	{
		key: "intervention",
		label: "Needs intervention",
		statuses: ["Issue Preventing Renewal", "Rescheduled", "Rejected", "Renewal Stopped"],
		intervention: true,
	},
	{ key: "done", label: "Done", statuses: ["Renewed"] },
];

// D-13: the fifth tile counted every record whose expiry is within seven days,
// which on this data is every record there is, and called itself "Expiring in 7
// days". It names an IC_RISK band instead, so the number it shows and the list
// a click on it opens are the same predicate.
const IC_TILES = [
	{ key: "payment", label: "Awaiting payment", status: "Awaiting Payment" },
	{ key: "ops", label: "Ops approval", status: "Awaiting Operations Approval" },
	{ key: "renewed", label: "Renewed", status: "Renewed" },
	{ key: "rejected", label: "Rejected", status: "Rejected" },
	{ key: "expired", label: "Already expired", risk: "expired" },
];

const IC_TABLE_ROWS = 6;
const IC_PAGE_ROWS = 50;

// note.3: the 60-day line is the WINDOW the page opens on, DISPLAY ONLY — it
// only narrows what the query returns, never writes anything. It matches the
// "Check iQama Renewal" scheduler event, which creates a new tracking record
// once the employee's existing one is older than 60 days and leaves the old
// one untouched (tools/design/SERVER-SCRIPTS-IQAMA.md q2-q4): a record past
// that age has already been superseded, so it is archive, not live work.
// Measured on `creation`, the only date every record is guaranteed to carry:
// frappe writes it at insert (apps/frappe/frappe/model/base_document.py:537-538)
// and it is a default field (apps/frappe/frappe/model/__init__.py:81-90). The
// DocType's own posting_date and contract_date are both optional with no
// default (hrms/hr/doctype/iqama_renewal_tracking/iqama_renewal_tracking.json),
// so a cutoff on either would silently drop every record that left them empty.
const IC_ARCHIVE_DAYS = 60;
const IC_AGE_FIELD = "creation";

// The scope is an AGE WINDOW and nothing else. Every record in this DocType is
// inserted by a server script on a schedule, so no person owns one and no
// status names a person's list: a scope written on `owner` or on a status set
// describes a population that does not exist.
//
// D-09: the window is declared ONCE, as an offset from today, and both the
// control's options and the server condition are derived from this table, so
// the button and the query cannot drift apart. An entry carrying neither
// `months` nor `days` writes no condition at all.
const IC_SCOPES = [
	{ key: "all", label_key: "scope_all" },
	{ key: "quarter", label_key: "scope_quarter", days: IC_ARCHIVE_DAYS },
	{ key: "day", label_key: "scope_day", days: 1 },
];

// 6,332 records older than the window are still undecided, 5,964 of them parked
// at one status. Opening on the whole table presents two years of dead records
// as today's work, so every view opens on the 60-day window. "all" still shows
// them — the window only hides, it never archives.
const IC_SCOPE_DEFAULT = "quarter";

// The two day thresholds every band on this page is built from. They are
// declared here because IC_OVERDUE_BUCKETS below reads their VALUES at
// declaration time, not inside a closure, and a const read before its own line
// throws at load rather than at use.
const IC_CRITICAL_DAYS = 7;
const IC_SOON_DAYS = 30;

// D-11: the twelve-month forward chart was empty because every record here has
// already expired. The axis runs into the past instead.
//
// D-09: a band is declared ONCE, as a pair of day bounds, and both the client
// test and the server date range are derived from that pair. A chip and the
// list it opens therefore cannot drift apart, because there is no second set of
// numbers for them to drift between. `from` and `to` are days remaining and
// both are inclusive; an absent bound is open.
const IC_OVERDUE_BUCKETS = [
	{ key: "over_year", label: "Over a year", to: -366 },
	{ key: "half_year", label: "6-12 months", from: -365, to: -181 },
	{ key: "quarter", label: "3-6 months", from: -180, to: -91 },
	{ key: "recent", label: "Under 3 months", from: -90, to: -1 },
	{ key: "due_soon", label: "Expiring soon", from: 0, to: IC_SOON_DAYS },
	// Keyed "clear", not "later": this bucket shares its bounds and its label
	// with IC_RISK's own "clear" entry below. ic_band(key) does
	// IC_BANDS.find(band => band.key === key) over IC_RISK.concat(this list),
	// so the same key makes it resolve to the IC_RISK object every other
	// "Later" chip already renders from, instead of a second, identical-looking
	// object the held-chip check then fails to recognise by reference.
	{ key: "clear", label: "Later", from: IC_SOON_DAYS + 1 },
];

// R10-A: the project filter's two alternate paths, declared once so the mode
// picker, _filters() and the two count builders (_count_by_project reads
// department, _count_by_cost_center reads cost_center) all key off the same
// two strings. `except` is the value _filters(except) is called with while
// computing THAT mode's own present-value list, so a chosen value never
// narrows the query used to list the values under it.
const IC_PROJECT_MODES = [
	{ key: "department", except: "project", label_key: "f_department" },
	{ key: "cost_center", except: "cost_center", label_key: "f_cost_center" },
];

const IC_PAYABLE_STATUS = "Awaiting Payment";
const IC_BOTH = "PR Created for Both Work Cards and Iqama Renewal";
const IC_ALLOWED_EMPLOYEE_STATUS = ["Active"];

const IC_PAYMENT_TYPES = {
	"PR Created for Work Cards": {
		beneficiary: "وزارة الموارد البشرية (مكتب العمل)",
		amount_field: "work_permit_fee",
		requires_sadad: true,
		reference_field: "pr_reference",
	},
	"PR Created for Iqama Renewal": {
		beneficiary: "خدمات المقيمين وزارة الداخلية",
		amount_field: "iqama_renewal_amount",
		requires_sadad: false,
		reference_field: "pr_reference_2",
	},
};

const IC_PR_DEFAULTS = {
	naming_series: "PR-.YYYY.-",
	project: "الادارة رئيسي - Head Office - AF",
	cost_center: "الادارة رئيسي - Head Office - AF",
	jv_status: "JV Not Created",
	payment_type: "SADAD Payment",
	mode_of_payment: "SADAD Payment",
	account_no: "SADAD numbers attached",
	payment_approver: "Human Resources - الموارد البشرية",
};

const IC_FIELDS = [
	"name",
	"employee",
	"employee_name",
	"department",
	"corporation",
	"company_name",
	"file_no",
	"cost_center",
	"status",
	"employee_status",
	"iqama_expiration_date",
	"iqama_new_expiration_date",
	"renewal_duration",
	"sadad_invoice",
	"pr_status",
	"pr_reference",
	"pr_reference_2",
	"iqama_renewal_amount",
	"work_permit_fee",
	"reason_of_preventing_renewal",
	"reason_of_not_renew",
	"iqama_renewal_issue",
	"traffic_violation_balance",
	"muqeem_balance",
	"exempt_compensation",
	"docstatus",
	"posting_date",
	"contract_date",
	"reschedule_date",
	"owner",
	"creation",
	"modified",
];

const IC_TEXT_COLUMNS = [0, 5, 9, 11, 12];

const IC_OUTSIDE_KSA_FIELD = "";
const IC_DATE_COLUMN_FIELD = "";
const IC_NITAQAT_FIELD = "";

const IC_LENSES = {
	operations: {
		label: "Operations",
		fields: [
			"iqama_expiration_date",
			"iqama_new_expiration_date",
			"renewal_duration",
			"employee_status",
			"reason_of_preventing_renewal",
			"reschedule_date",
		],
	},
	accounts: {
		label: "Accounts",
		fields: [
			"work_permit_fee",
			"iqama_renewal_amount",
			"payment_requests",
			"traffic_violation_balance",
		],
	},
	all: {
		label: "Everything",
		fields: [
			"iqama_expiration_date",
			"iqama_new_expiration_date",
			"renewal_duration",
			"employee_status",
			"file_no",
			"work_permit_fee",
			"iqama_renewal_amount",
			"payment_requests",
			"reason_of_preventing_renewal",
			"reason_of_not_renew",
			"reschedule_date",
			"traffic_violation_balance",
		],
	},
};

const IC_FIELD_LABELS = {
	iqama_expiration_date: "Expires",
	iqama_new_expiration_date: "New expiry",
	reschedule_date: "Reschedule date",
	contract_date: "Contract date",
	renewal_duration: "Duration",
	renewal_preference: "Renewal preference",
	employee_status: "Employee status",
	file_no: "Employer file",
	cost_center: "Cost center",
	sadad_invoice: "SADAD",
	work_permit_fee: "Work card fee",
	iqama_renewal_amount: "Iqama fee",
	traffic_violation_balance: "Traffic violations",
	total_amount: "Total amount",
	muqeem_balance_after_renewal: "Muqeem balance after renewal",
	refundable_balance: "Refundable balance",
	exempt_compensation: "Exempt from compensation",
	payment_requests: "Payment requests",
	reason_of_preventing_renewal: "Blocking reason",
	reason_of_not_renew: "Reason not renewed",
	status: "Status",
	pr_status: "Payment request status",
};

const IC_DATE_FIELDS = [
	"iqama_expiration_date",
	"iqama_new_expiration_date",
	"posting_date",
	"contract_date",
	"reschedule_date",
];
// total_amount is written by the page but never fetched into IC_FIELDS; it
// reaches the screen only through the version-history feed (ic_store.js
// _history_entries), which formats a changed field as money once
// IC_FIELD_LABELS carries its label — so this entry is live, not dead.
const IC_MONEY_FIELDS = ["work_permit_fee", "iqama_renewal_amount", "total_amount"];

// The DocType's own Select options mix casing on purpose — "9 Months" is
// capitalized where the other three options are not (iqama_renewal_tracking
// .json:159, field renewal_duration). These keys are transcribed exactly as
// the DocType stores them; ic_duration_period() below is the one reader of
// this table, so no lookup breaks on the capital M again.
const IC_DURATION_MONTHS = { "3 months": 3, "6 months": 6, "9 Months": 9, "1 year": 12 };

// D1: a lookup keyed on the exact stored string breaks on "9 Months"'s capital
// M, so every READ of a renewal_duration value goes through this instead of
// indexing IC_DURATION_MONTHS directly. The match folds case and collapses
// whitespace; the stored value is never rewritten, and an option this table
// does not carry falls through with 0 months and its own raw text as the
// label rather than disappearing.
function ic_duration_period(value) {
	const raw = String(value === null || value === undefined ? "" : value).trim();
	const canonical = raw.toLowerCase().replace(/\s+/g, " ");
	const label = Object.keys(IC_DURATION_MONTHS).find(
		(option) => option.toLowerCase().replace(/\s+/g, " ") === canonical
	);
	return label ? { months: IC_DURATION_MONTHS[label], label: label } : { months: 0, label: raw };
}

const IC_WORK_PERMIT_FEE = { 3: 2425.0, 6: 4850.0, 9: 7275.0, 12: 9700.0 };
const IC_IQAMA_FEE = { 3: 163.0, 6: 325.0, 9: 488.0, 12: 650.0 };
const IC_EXEMPT_WORK_PERMIT_FEE = 100.0;
const IC_EXEMPT_DURATION = "1 year";

// The statuses a record is still being WORKED in. It is a status test and not
// a scope: it answers whether a row needs a person now, and it is read by the
// dashboard's "needs action today" list and nowhere else.
const IC_WORKING_STATES = ["New", "Awaiting Operations Approval", "Awaiting Payment"];

const IC_SETTLED = ["Renewed", "Rejected", "Renewal Stopped"];
const IC_BLOCKED_STATUS = "Issue Preventing Renewal";

// The four bands the list filters on, declared in the same day bounds the
// chart buckets use. Every band on this page — chip, chart bar or tile — is one
// entry in IC_BANDS, so a count and the list it opens are the same query.
const IC_RISK = [
	{ key: "expired", label: "Expired", to: -1 },
	{ key: "critical", label: "7 days", from: 0, to: IC_CRITICAL_DAYS },
	{ key: "soon", label: "30 days", from: IC_CRITICAL_DAYS + 1, to: IC_SOON_DAYS },
	{ key: "clear", label: "Later", from: IC_SOON_DAYS + 1 },
];

const IC_BANDS = IC_RISK.concat(IC_OVERDUE_BUCKETS);

// Every node that renders text a human typed into the record. Arabic names sit
// beside Latin fragments and trailing punctuation, so each one resolves its own
// direction instead of inheriting the container's.
const IC_AUTO_DIR = [
	".ic-row-name",
	".ic-row-org",
	".ic-detail-name",
	".ic-detail-sub",
	".ic-field-value",
	".ic-history-what",
	".ic-flag--warn",
	".ic-b-name",
	".ic-b-org",
	".ic-b-reason",
	".ic-today-name",
	".ic-decision-value",
	".ic-money-value",
	".ic-history-who",
	".ic-b-flagged-name",
	".ic-b-flagged-why",
].join(", ");

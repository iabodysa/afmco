// Copyright (c) 2026, AFMCO and contributors

const SB_API = "afmco.financial_operations.api.sadad.";
const SB_DOCTYPE = "SADAD Group V2";
const SB_PAGE_LENGTH = 50;
const SB_VIEWS = ["batches", "compose", "overview"];
const SB_DOCSTATUS_FILTERS = [
	{ value: "", label: "state_all" },
	{ value: "0", label: "state_draft" },
	{ value: "1", label: "state_submitted" },
	{ value: "2", label: "state_cancelled" },
];
const SB_STATE_COLOR = {
	draft: "orange",
	submitted: "blue",
	payment_request: "purple",
	journal_entry: "green",
	cancelled: "red",
};
const SB_ROUTES = {
	payment_request: "Payment Requisition",
	journal_entry: "Journal Entry",
};

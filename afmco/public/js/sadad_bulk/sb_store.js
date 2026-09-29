// Copyright (c) 2026, AFMCO and contributors

class SadadStore {
	constructor() {
		this.view = "batches";
		this.filters = { docstatus: "", search: "", from_date: "", to_date: "" };
		this.rows = [];
		this.more = false;
		this.current = null;
		this.batch = null;
		this.setup = null;
		this.preview = null;
		this.reset_compose("");
	}

	reset_compose(batch) {
		this.compose = {
			fee_type: "",
			period: "",
			bank_payment_date: frappe.datetime.get_today(),
			sadad_invoice_number: "",
			employees: "",
			batch: batch || "",
		};
		this.preview = null;
	}

	async load_setup() {
		if (!this.setup) {
			this.setup = await sb_call("get_setup");
		}
		return this.setup;
	}

	fee_types() {
		return [...new Set((this.setup || []).map((row) => row.types_english))];
	}

	periods(fee_type) {
		return (this.setup || []).filter((row) => row.types_english === fee_type);
	}

	async load_batches(append) {
		const start = append ? this.rows.length : 0;
		const result = await sb_call("list_batches", {
			...this.filters,
			start,
			page_length: SB_PAGE_LENGTH,
		});
		this.rows = append ? this.rows.concat(result.rows) : result.rows;
		this.more = result.rows.length === SB_PAGE_LENGTH;
		return this.rows;
	}

	async load_batch(name) {
		this.current = name;
		this.batch = name ? await sb_call("get_batch", { name }) : null;
		return this.batch;
	}

	async load_overview() {
		return sb_call("overview");
	}

	compose_args() {
		const args = { ...this.compose };
		Object.keys(args).forEach((key) => {
			if (args[key] === "") {
				delete args[key];
			}
		});
		return args;
	}

	async run_preview() {
		this.preview = await sb_call("preview_lines", this.compose_args(), "POST");
		return this.preview;
	}

	async add_lines() {
		const result = await sb_call("add_lines", this.compose_args(), "POST");
		this.preview = null;
		return result;
	}
}

// Copyright (c) 2026, AFMCO and contributors

class SadadActions {
	constructor(app) {
		this.app = app;
	}

	async run(action, batch, detail) {
		const handlers = {
			csv: () => this.download_csv(batch),
			payment_request: () => this.payment_request(batch),
			submit: () => this.submit(batch),
			journal_entry: () => this.journal_entry(batch),
			cancel: () => this.cancel(batch),
			form: () => frappe.set_route("Form", SB_DOCTYPE, batch),
			add_lines: () => this.app.compose(batch),
			remove: () => this.remove(batch, detail.employee, detail.type),
		};
		if (handlers[action]) {
			await handlers[action]();
		}
	}

	confirm(message) {
		return new Promise((resolve) => frappe.confirm(message, () => resolve(true), () => resolve(false)));
	}

	async download_csv(batch) {
		const file = await sb_call("bank_csv", { batch });
		sb_download(file.filename, file.content);
	}

	async payment_request(batch) {
		if (!(await this.confirm(sb_t("confirm_pr", sb_esc(batch))))) {
			return;
		}
		const result = await sb_call("create_payment_request", { batch }, "POST");
		this.opened(SB_ROUTES.payment_request, result);
	}

	async journal_entry(batch) {
		if (!(await this.confirm(sb_t("confirm_je", sb_esc(batch))))) {
			return;
		}
		const result = await sb_call("create_journal_entry", { batch }, "POST");
		this.opened(SB_ROUTES.journal_entry, result);
	}

	async submit(batch) {
		if (!(await this.confirm(sb_t("confirm_submit", sb_esc(batch))))) {
			return;
		}
		await sb_call("submit_batch", { batch }, "POST");
		frappe.show_alert({ message: sb_t("submitted_msg", sb_esc(batch)), indicator: "green" });
		await this.app.views.batches.reload(batch);
	}

	async cancel(batch) {
		if (!(await this.confirm(sb_t("confirm_cancel", sb_esc(batch))))) {
			return;
		}
		const result = await sb_call("cancel_batch", { batch }, "POST");
		const lines = result.documents.map((row) => sb_esc(sb_t(`result_${row.result}`, row.name)));
		frappe.msgprint({
			title: sb_t("cancelled_msg", sb_esc(batch)),
			message: lines.join("<br>") || sb_esc(sb_t("cancelled_msg", batch)),
			indicator: "green",
		});
		await this.app.views.batches.reload(batch);
	}

	async remove(batch, employee, fee_type) {
		if (!(await this.confirm(sb_t("confirm_remove", sb_esc(employee), sb_esc(fee_type))))) {
			return;
		}
		await sb_call("remove_line_group", { batch, employee, fee_type }, "POST");
		await this.app.views.batches.reload(batch);
	}

	opened(doctype, result) {
		frappe.show_alert({
			message: sb_t(result.existing ? "existing_doc" : "created_doc", sb_esc(result.name)),
			indicator: result.existing ? "orange" : "green",
		});
		frappe.set_route("Form", doctype, result.name);
	}
}

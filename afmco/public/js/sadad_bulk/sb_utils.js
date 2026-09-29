// Copyright (c) 2026, AFMCO and contributors

const SB_MONEY = new Intl.NumberFormat(SB_DATA_LOCALE, {
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

function sb_esc(value) {
	return frappe.utils.escape_html(value === null || value === undefined ? "" : String(value));
}

function sb_money(value) {
	return SB_MONEY.format(Number(value) || 0);
}

function sb_date(value) {
	return value ? String(value).slice(0, 10) : "";
}

function sb_chip(state) {
	return `<span class="indicator-pill ${SB_STATE_COLOR[state] || "gray"} sb-chip">${sb_esc(
		sb_t(`state_${state}`)
	)}</span>`;
}

function sb_call(method, args, type) {
	return new Promise((resolve, reject) => {
		frappe.call({
			method: SB_API + method,
			args: args || {},
			type: type || "GET",
			freeze: type === "POST",
			callback: (response) => resolve(response.message),
			error: (error) => reject(error),
		});
	});
}

function sb_download(filename, content) {
	const url = URL.createObjectURL(new Blob([content], { type: "text/csv" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

function sb_doc_links(doctype, rows) {
	if (rows === null || rows === undefined) {
		return `<span class="text-muted">${sb_esc(sb_t("no_access"))}</span>`;
	}
	if (!rows.length) {
		return `<span class="text-muted">${sb_esc(sb_t("none"))}</span>`;
	}
	return rows
		.map(
			(row) =>
				`<a href="${frappe.utils.get_form_link(doctype, row.name)}">${sb_esc(
					row.name
				)}</a>${row.workflow_state ? ` <span class="text-muted">${sb_esc(__(row.workflow_state))}</span>` : ""}`
		)
		.join("<br>");
}

function sb_button(action, label, enabled, reason, extra) {
	return `<button type="button" class="btn btn-sm ${extra || "btn-default"}" data-action="${action}" ${
		enabled ? "" : `disabled title="${sb_esc(reason)}"`
	}>${sb_esc(label)}</button>`;
}

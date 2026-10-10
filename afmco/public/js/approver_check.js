// Copyright (c) 2026, AFMCO and contributors

frappe.provide("afmco.approver_check");

afmco.approver_check.METHOD = "afmco.financial_operations.api.approver_check.run";
afmco.approver_check.STORAGE_PREFIX = "afmco-approver-check";

afmco.approver_check.status_meta = function (status) {
	return {
		fail: { icon: "✕", word: __("Fail", null, "Approver Check") },
		warn: { icon: "!", word: __("Warning", null, "Approver Check") },
		unknown: { icon: "?", word: __("Could not verify", null, "Approver Check") },
		pass: { icon: "✓", word: __("Pass", null, "Approver Check") },
		na: { icon: "–", word: __("Not applicable", null, "Approver Check") },
	}[status];
};

afmco.approver_check.seen = function (key) {
	try {
		return window.sessionStorage.getItem(key) === "1";
	} catch (e) {
		return false;
	}
};

afmco.approver_check.remember = function (key) {
	try {
		window.sessionStorage.setItem(key, "1");
	} catch (e) {
		return;
	}
};

afmco.approver_check.attach = function (frm) {
	const label = __("Approver Check");
	frm.remove_custom_button(label);
	if (frm.is_new() || !(frm.doc.__onload || {}).approver_check_allowed) {
		return;
	}
	frm.add_custom_button(label, () => afmco.approver_check.open(frm));
	const key = [afmco.approver_check.STORAGE_PREFIX, frm.doctype, frm.docname, frm.doc.modified].join(":");
	if (!afmco.approver_check.seen(key)) {
		afmco.approver_check.remember(key);
		afmco.approver_check.open(frm);
	}
};

afmco.approver_check.open = function (frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Approver Check — {0}", [frm.docname]),
		size: "extra-large",
		fields: [{ fieldtype: "HTML", fieldname: "body" }],
		primary_action_label: __("Re-run"),
		primary_action: () => afmco.approver_check.load(dialog, frm),
		secondary_action_label: __("Close"),
		secondary_action: () => dialog.hide(),
	});
	dialog.$wrapper.addClass("afmco-approver-check");
	dialog.show();
	afmco.approver_check.load(dialog, frm);
};

afmco.approver_check.load = function (dialog, frm) {
	const body = dialog.fields_dict.body.$wrapper;
	body.html(afmco.approver_check.skeleton());
	frappe
		.call({ method: afmco.approver_check.METHOD, args: { doctype: frm.doctype, name: frm.docname } })
		.then((r) => body.html(afmco.approver_check.render(r.message)))
		.catch(() => body.html(`<p class="ac-error">${__("The approver check could not run.")}</p>`));
};

afmco.approver_check.skeleton = function () {
	const bars = [1, 2, 3, 4].map(() => '<div class="ac-skeleton-row"></div>').join("");
	return `<div class="ac-skeleton"><p>${__("Checking...")}</p>${bars}</div>`;
};

afmco.approver_check.render = function (run) {
	const counts = run.counts;
	const headline = run.blocking
		? `<div class="ac-headline ac-blocking">${__("Do not approve until the red items are resolved")}</div>`
		: `<div class="ac-headline ac-clear">${__("No blocking issue found")}</div>`;
	const counters = ["fail", "warn", "unknown"]
		.map((status) => {
			const meta = afmco.approver_check.status_meta(status);
			return `<span class="ac-counter ac-${status}"><span class="ac-icon">${meta.icon}</span> ${meta.word}: ${counts[status]}</span>`;
		})
		.join("");
	const sections = run.categories
		.map((category) => afmco.approver_check.section(category, run.items.filter((item) => item.category === category.id)))
		.join("");
	const hidden = counts.na
		? `<details class="ac-na"><summary>${__("Not applicable ({0})", [counts.na])}</summary>${run.items
				.filter((item) => item.status === "na")
				.map(afmco.approver_check.row)
				.join("")}</details>`
		: "";
	return `
		<div class="ac-header">${headline}<div class="ac-counters">${counters}</div></div>
		${sections}
		${hidden}
		<p class="ac-advisory">${__("This check advises; it does not stop approval.")}</p>`;
};

afmco.approver_check.section = function (category, items) {
	const shown = items.filter((item) => item.status !== "na");
	if (!shown.length) {
		return "";
	}
	const open = shown.some((item) => item.status !== "pass") ? " open" : "";
	return `<details class="ac-section"${open}><summary>${frappe.utils.escape_html(category.label)}</summary>${shown
		.map(afmco.approver_check.row)
		.join("")}</details>`;
};

afmco.approver_check.tone = function (item) {
	if (item.status !== "fail" && item.status !== "warn") {
		return item.status;
	}
	if (item.severity === "info") {
		return "info";
	}
	return item.status === "fail" && item.severity === "block" ? "fail" : "warn";
};

afmco.approver_check.row = function (item) {
	const meta = afmco.approver_check.status_meta(item.status);
	const tone = afmco.approver_check.tone(item);
	const blocking =
		item.status === "fail" && item.severity === "block" ? `<span class="ac-badge ac-badge-block">${__("Blocking")}</span>` : "";
	const ai = item.mode === "ai" ? `<span class="ac-badge">${__("AI")}</span>` : "";
	const evidence = (item.evidence || []).map(afmco.approver_check.evidence).join("");
	const detail = `<div class="ac-detail">${frappe.utils.escape_html(item.detail || "")}</div>`;
	const head = `<span class="ac-icon ac-${tone}">${meta.icon}</span><span class="ac-word ac-${tone}">${meta.word}</span><span class="ac-label">${frappe.utils.escape_html(item.label)}</span>${blocking}${ai}`;
	if (!evidence) {
		return `<div class="ac-row ac-row-${tone}"><div class="ac-row-head">${head}</div>${detail}</div>`;
	}
	return `<details class="ac-row ac-row-${tone}"><summary class="ac-row-head">${head}</summary>${detail}<ul class="ac-evidence">${evidence}</ul></details>`;
};

afmco.approver_check.evidence = function (entry) {
	const value = `<bdi dir="auto">${frappe.utils.escape_html(entry.value || "")}</bdi>`;
	const label = frappe.utils.escape_html(entry.label || "");
	const target = entry.link ? frappe.utils.get_form_link(entry.link.doctype, entry.link.name) : null;
	const shown = target ? `<a href="${target}" target="_blank" rel="noopener">${value}</a>` : value;
	return `<li><span class="ac-evidence-label">${label}:</span> ${shown}</li>`;
};

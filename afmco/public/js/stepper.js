// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide("afmco.stepper");

afmco.stepper = {
	html({ stages, current, color = "gray", halted = false, live = false, note = "" }) {
		const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
		const items = stages.map((stage, index) => {
			const state = index < current ? "done" : index === current ? `now ${color}` : "next";
			const pulse = index === current && live ? " afmco-step-live" : "";
			const mark = index < current ? "✓" : index === current && halted ? "!" : index + 1;
			return `<li class="afmco-step afmco-step-${state}${pulse}"><span class="afmco-step-mark">${mark}</span><span class="afmco-step-label">${esc(__(stage))}</span></li>`;
		});
		if (note && current >= 0) {
			const at = Math.min(current, stages.length - 1);
			const from = Math.max(at, 1);
			const to = Math.min(at + 3, stages.length + 1);
			items.push(`<li class="afmco-step-note" style="grid-row: 2; grid-column: ${from} / ${to}">${esc(note)}</li>`);
		}
		return `<div class="afmco-stepper-box"><ol class="afmco-stepper" style="--afmco-steps: ${stages.length}">${items.join("")}</ol></div>`;
	},

	center(container) {
		const box = $(container).find(".afmco-stepper-box")[0];
		const now = box && box.querySelector(".afmco-step-now");
		if (!now || box.scrollWidth <= box.clientWidth) return;
		const target = now.offsetLeft - (box.clientWidth - now.offsetWidth) / 2;
		box.scrollLeft = getComputedStyle(box).direction === "rtl" ? target - (box.scrollWidth - box.clientWidth) : target;
	},

	value_before(frm, fieldname, value) {
		for (const version of frm.get_docinfo()?.versions || []) {
			const change = (JSON.parse(version.data || "{}").changed || []).find(
				([field, , next]) => field === fieldname && next === value
			);
			if (change) return change[1];
		}
		return null;
	},
};

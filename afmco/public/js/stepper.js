// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide("afmco.stepper");

afmco.stepper = {
	html({ stages, current, color = "gray", halted = false, live = false, note = "", skipped = [] }) {
		const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
		const items = stages.map((stage, index) => {
			const skip = index < current && skipped.includes(index);
			const state = skip ? "skipped" : index < current ? "done" : index === current ? `now ${color}` : "next";
			const pulse = index === current && live ? " afmco-step-live" : "";
			const mark = index < current && !skip ? "✓" : index === current && halted ? "!" : index + 1;
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

	workflow(frm) {
		const state = frm.doc.workflow_state;
		if (frm.is_new() || !state) return null;
		frappe.workflow.setup(frm.doctype);
		const workflow = frappe.workflow.workflows[frm.doctype];
		if (!workflow) return null;

		const halts = new Set(workflow.states.filter((row) => cint(row.doc_status) === 2).map((row) => row.state));
		workflow.transitions.filter((row) => row.action === "Reject").forEach((row) => halts.add(row.next_state));
		const reached = new Set(workflow.transitions.map((row) => row.next_state));
		const stages = [...new Set(workflow.states.map((row) => row.state))].filter(
			(stage, index) => !halts.has(stage) && (index === 0 || reached.has(stage))
		);

		const halted = halts.has(state);
		let current = stages.indexOf(state);
		const seen = new Set((frm.doc.__onload || {}).workflow_states_seen || []);
		let known = true;
		if (halted) {
			const before = stages.indexOf(afmco.stepper.value_before(frm, "workflow_state", state));
			const furthest = Math.max(-1, ...stages.map((stage, index) => (seen.has(stage) ? index : -1)));
			current = before >= 0 ? before : furthest;
			known = current >= 0;
		} else if (current < 0) {
			return null;
		} else if (current === stages.length - 1 && frm.doc.docstatus === 1) {
			current = stages.length;
		}

		const bypassed = new Set();
		workflow.transitions.forEach((row) => {
			const from = stages.indexOf(row.state);
			const to = stages.indexOf(row.next_state);
			for (let index = from + 1; from >= 0 && index < to; index++) bypassed.add(index);
		});
		const skipped = known && seen.size ? [...bypassed].filter((index) => index < current && !seen.has(stages[index])) : [];
		return { stages, current, halted, skipped };
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

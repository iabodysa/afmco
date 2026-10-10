// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide("afmco.attachment_check");

afmco.attachment_check = {
	METHOD: "afmco.financial_operations.api.approver_check.verify_attachments",
	EVENT: "afmco_attachment_reading",
	STATES: {
		reading: () => __("Reading attachments"),
		failed: () => __("Attachments could not be read, review them yourself"),
		finding: () => __("Review these points in the attachments"),
		clean: () => __("Attachments match the request"),
	},

	render(frm) {
		const check = (frm.doc.__onload || {}).attachment_check;
		this.listen(frm);
		if (check) {
			frm.add_custom_button(__("Verify attachments"), () => this.verify(frm));
		}
		this.show(frm, check ? check.state : null);
	},

	verify(frm) {
		frappe
			.xcall(this.METHOD, { doctype: frm.doctype, name: frm.doc.name })
			.then((state) => this.show(frm, state));
	},

	listen(frm) {
		if (frm.attachment_check_listener) return;
		frm.attachment_check_listener = (data) => {
			if (data && data.doctype === frm.doctype && data.name === frm.doc.name) {
				frm.reload_doc();
			}
		};
		frappe.realtime.on(this.EVENT, frm.attachment_check_listener);
	},

	section(frm) {
		if (!frm.attachment_check_body) {
			frm.attachment_check_body = frm.dashboard.add_section("", __("Attachments"), "afmco-attachment-check");
		}
		return frm.attachment_check_body;
	},

	show(frm, state) {
		const body = this.section(frm);
		const wrapper = body.closest(".form-dashboard-section");
		if (!state || !this.STATES[state.status]) {
			wrapper.addClass("hidden");
			return;
		}
		body.html(this.html(state));
		wrapper.removeClass("hidden");
		frm.dashboard.show();
	},

	html(state) {
		const esc = frappe.utils.escape_html;
		const time = state.at
			? `<span class="ac-time">${esc(__("Read {0}", [frappe.datetime.prettyDate(state.at)]))}</span>`
			: "";
		const findings = (state.findings || [])
			.map(
				(finding) =>
					`<li class="ac-finding"><span class="ac-label">${esc(finding.label)}</span><span class="ac-detail">${esc(finding.detail)}</span></li>`
			)
			.join("");
		return `<div class="ac-check" data-status="${esc(state.status)}">
			<div class="ac-head"><span class="ac-dot"></span><span class="ac-status">${esc(this.STATES[state.status]())}</span>${time}</div>
			${findings ? `<ul class="ac-findings">${findings}</ul>` : ""}
		</div>`;
	},
};

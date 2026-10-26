// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide("afmco.leave_balance");

afmco.leave_balance.API = "afmco.people_and_payroll.api.advance_leave_salary.";

afmco.leave_balance.details = function (frm, before_2024) {
	return frappe.xcall(
		afmco.leave_balance.API + "leave_details",
		{ doctype: frm.doctype, name: frm.docname, before_2024: before_2024 || null },
		"GET"
	);
};

afmco.leave_balance.table = function (data) {
	const day = (value) => frappe.datetime.str_to_user(value);
	const head = [
		__("Contract Year"),
		__("From"),
		__("To"),
		__("Entitlement"),
		__("Balance Used"),
		__("Leave Without Pay"),
		__("Absence"),
		__("Unpaid Days"),
		__("Proposed Extension"),
		__("Balance"),
	]
		.map((label) => `<th>${label}</th>`)
		.join("");
	const rows = data.years
		.map(
			(year) => `<tr>
				<td>${year.k}</td>
				<td>${day(year.start)}</td>
				<td>${day(year.end)}</td>
				<td>${year.taken ? __("Taken") : year.entitlement}</td>
				<td>${year.used}</td>
				<td>${year.leave}</td>
				<td>${year.absent}</td>
				<td>${year.unpaid}</td>
				<td>${year.unpaid}</td>
				<td>${year.balance}</td>
			</tr>`
		)
		.join("");
	return `<div class="table-responsive"><table class="table table-bordered table-sm">
		<thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
};

afmco.leave_balance.notice = function (data) {
	const lines = [];
	if (data.ask_before_2024) {
		lines.push(
			`<div class="alert alert-warning">${__(
				"The employee joined before 2024 and has no leave records before 2024. Choose how the contract years before 2024 count."
			)}</div>`
		);
	}
	if (data.remembered_from) {
		lines.push(
			`<div class="alert alert-info">${__(
				"Contract years before 2024 count as {0}, as decided in {1}.",
				[__(data.before_2024), frappe.utils.escape_html(data.remembered_from)]
			)}</div>`
		);
	}
	if (data.extension > 0) {
		const employee = encodeURIComponent(data.employee);
		const links = [
			data.exit_reentry_visas
				? `<a href="/app/employee-visa?employee=${employee}" target="_blank">${__("Exit and Re-entry Visas")}</a>`
				: "",
			`<a href="/app/leave-application?employee=${employee}&status=Approved" target="_blank">${__("Leave Applications")}</a>`,
			`<a href="/app/attendance?employee=${employee}&status=Absent" target="_blank">${__("Absence")}</a>`,
		].filter(Boolean);
		lines.push(
			`<div class="alert alert-warning">${__(
				"The contract year extends by {0} days. Check the exit and re-entry records before extending.",
				[data.extension]
			)}<br>${links.join(" | ")}</div>`
		);
	}
	return lines.join("");
};

afmco.leave_balance.calculate = async function (frm) {
	if (frm.is_dirty()) await frm.save();
	let data = await afmco.leave_balance.details(frm, frm.doc.before_2024_leave);
	const render = () => {
		dialog.fields_dict.notice.$wrapper.html(afmco.leave_balance.notice(data));
		dialog.fields_dict.years.$wrapper.html(afmco.leave_balance.table(data));
	};
	const decide = async (extension) => {
		const before_2024 = dialog.get_value("before_2024");
		if (data.ask_before_2024 && !before_2024) {
			frappe.msgprint(__("Choose how the contract years before 2024 count."));
			return;
		}
		await frappe.call({
			method: afmco.leave_balance.API + "fill_leave_allowance",
			args: { doctype: frm.doctype, name: frm.docname, extension, before_2024 },
			freeze: true,
		});
		dialog.hide();
		frm.reload_doc();
	};
	const dialog = new frappe.ui.Dialog({
		title: __("Leave Balance and Contract Years"),
		size: "extra-large",
		fields: [
			{
				fieldname: "before_2024",
				fieldtype: "Select",
				label: __("Contract Years Before 2024"),
				options: ["", "Taken", "Balance"],
				default: data.ask_before_2024 ? data.before_2024 : null,
				hidden: !data.ask_before_2024,
				change: async () => {
					data = await afmco.leave_balance.details(frm, dialog.get_value("before_2024"));
					render();
				},
			},
			{ fieldname: "notice", fieldtype: "HTML" },
			{ fieldname: "years", fieldtype: "HTML" },
		],
		primary_action_label: __("Extend"),
		primary_action: () => decide("Extend"),
		secondary_action_label: __("No extension"),
		secondary_action: () => decide("No extension"),
	});
	render();
	dialog.show();
};

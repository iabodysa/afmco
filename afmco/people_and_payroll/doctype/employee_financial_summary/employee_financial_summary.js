// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.ui.form.on("Employee Financial Summary", {
	refresh(frm) {
		frm.disable_save();
		frappe.require("employee_financial_summary.bundle.css");

		let root = frm.layout.wrapper.find(".efs-root");
		if (!root.length) {
			root = $('<div class="efs-root"><div class="efs-toolbar"></div><div class="efs-body"></div></div>').prependTo(frm.layout.wrapper);
			frm.efs_picker = frappe.ui.form.make_control({
				parent: root.find(".efs-toolbar"),
				df: {
					fieldtype: "Link",
					options: "Employee",
					fieldname: "efs_employee",
					label: __("Employee"),
					change() {
						const value = frm.efs_picker.get_value();
						if (value && value !== frm.efs_employee) {
							frm.efs_employee = value;
							load();
						}
					},
				},
				render_input: true,
			});
		}
		const body = root.find(".efs-body");
		const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
		const money = (v) => format_currency(v || 0, "SAR");
		const day = (v) => (v ? frappe.datetime.str_to_user(v) : "");
		const link = (doctype, name, text) => frappe.utils.get_form_link(doctype, name, true, text);
		const shown = (s) => !!s && !s.hidden;
		const kpi = (label, value, hint, accent) =>
			`<div class="efs-kpi${accent ? " efs-kpi--accent" : ""}"><div class="efs-kpi__label">${esc(label)}</div><div class="efs-kpi__value">${value}</div><div class="efs-kpi__hint">${hint || ""}</div></div>`;
		const panel = (title, inner) => `<section class="efs-panel"><h4 class="efs-panel__title">${esc(title)}</h4>${inner}</section>`;
		const empty = (text) => `<div class="efs-empty">${esc(text)}</div>`;
		const numClass = (h) => (h[1] ? "efs-num" : "");
		const rowHtml = (heads, cells) => `<tr>${cells.map((c, i) => `<td class="${numClass(heads[i])}">${c}</td>`).join("")}</tr>`;

		const tables = {
			slips: {
				heads: [[__("Month")], [__("Gross"), 1], [__("Deductions"), 1], [__("Net"), 1]],
				cells: (s) => [link("Salary Slip", s.name, day(s.start_date)), money(s.gross_pay), money(s.total_deduction), money(s.net_pay)],
			},
			loans: {
				heads: [[__("Loan")], [__("Date")], [__("Status")], [__("Amount"), 1], [__("Balance"), 1]],
				cells: (l) => [link("Loan", l.name), day(l.posting_date), esc(__(l.status)), money(l.disbursed_amount || l.loan_amount), money(l.balance)],
			},
			advances: {
				heads: [[__("Advance", null, "Employee Financial Summary")], [__("Date")], [__("Status")], [__("Amount"), 1], [__("Balance"), 1]],
				cells: (a) => [link("Employee Advance", a.name), day(a.posting_date), esc(__(a.status)), money(a.paid_amount), money(a.balance)],
			},
			eos_records: {
				heads: [[__("Document")], [__("Period")], [__("State")], [__("Amount"), 1]],
				cells: (r) => [link("End of Service Settlement", r.name), `${day(r.date_1)} - ${day(r.date_2)}`, esc(__(r.workflow_state)), money(r.amount)],
			},
			leave_balance: {
				heads: [[__("Leave Type")], [__("Balance"), 1]],
				cells: (l) => [esc(l.leave_type), esc(l.balance)],
			},
			vacation_records: {
				heads: [[__("Document")], [__("Period")], [__("State")], [__("Amount"), 1]],
				cells: (r) => [link("Advance Leave Salary", r.name), `${day(r.date_1)} - ${day(r.date_2)}`, esc(__(r.workflow_state)), money(r.amount)],
			},
			ledger: {
				heads: [[__("Account")], [__("Balance"), 1]],
				cells: (g) => [esc(g.account), money(g.balance)],
			},
			requisitions: {
				heads: [[__("Document")], [__("Date")], [__("State")], [__("Amount"), 1]],
				cells: (r) => [link("Payment Requisition", r.name), day(r.date), esc(__(r.workflow_state)), money(r.amount)],
			},
		};

		const paged = (key, page) => {
			const t = tables[key];
			if (!page.rows.length) return empty(__("No records"));
			return `<div class="efs-paged" data-section="${key}" data-count="${page.rows.length}"><table class="efs-table"><thead><tr>${t.heads.map((h) => `<th class="${numClass(h)}">${esc(h[0])}</th>`).join("")}</tr></thead><tbody>${page.rows.map((r) => rowHtml(t.heads, t.cells(r))).join("")}</tbody></table>${page.has_more ? `<button type="button" class="btn btn-xs btn-default efs-more">${__("Show more")}</button>` : ""}</div>`;
		};

		body.off("click.efs").on("click.efs", ".efs-more", function () {
			const btn = $(this);
			const box = btn.closest(".efs-paged");
			const key = box.attr("data-section");
			const offset = parseInt(box.attr("data-count"), 10) || 0;
			const employee = frm.efs_employee;
			btn.prop("disabled", true);
			frappe
				.xcall("afmco.people_and_payroll.api.employee_financial_summary.get_employee_financial_summary", { employee, section: key, offset })
				.then((r) => {
					const page = r && r[key];
					if (employee !== frm.efs_employee) return;
					if (!shown(page)) {
						btn.remove();
						return;
					}
					const t = tables[key];
					box.find("tbody").append(page.rows.map((row) => rowHtml(t.heads, t.cells(row))).join(""));
					box.attr("data-count", offset + page.rows.length);
					if (page.has_more && page.rows.length) {
						btn.prop("disabled", false);
					} else {
						btn.remove();
					}
				})
				.catch(() => btn.remove());
		});

		function render(d) {
			const e = d.employee;
			const kpis = [];
			const panels = [];
			let head = "";

			if (shown(e)) {
				const initials = (e.employee_name || e.name).split(" ").filter(Boolean).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
				head = `<section class="efs-panel efs-head"><div class="efs-avatar">${esc(initials)}</div><div><div class="efs-name">${esc(e.employee_name)}</div><div class="efs-meta"><span>${link("Employee", e.name)}</span><span>${esc(e.designation)}</span><span>${esc(e.department)}</span><span>${esc(e.branch)}</span><span>${esc(__(e.status))}</span><span>${__("Joined")} ${day(e.date_of_joining)}</span>${e.relieving_date ? `<span>${__("Relieved")} ${day(e.relieving_date)}</span>` : ""}</div></div></section>`;
			}

			if (shown(d.structure)) {
				const s = d.structure.value;
				kpis.push(kpi(__("Monthly wage"), s ? money(s.wage) : "-", s ? `${__("Since")} ${day(s.from_date)}` : __("No salary structure"), true));
				panels.push(
					panel(
						__("Salary structure"),
						s
							? `<dl class="efs-kv">${s.parts.map((p) => `<dt>${esc(__(p[0]))}</dt><dd>${money(p[1])}</dd>`).join("")}<dt class="efs-total">${__("Total")}</dt><dd class="efs-total">${money(s.wage)}</dd></dl><div class="efs-note">${link("Salary Structure Assignment", s.name)}</div>`
							: empty(__("No salary structure"))
					)
				);
			}

			if (shown(d.last_slip)) {
				const last = d.last_slip.slip;
				const part = (field) => d.last_slip.breakdown.filter((b) => b.parentfield === field);
				const kv = (rows) => (rows.length ? `<dl class="efs-kv">${rows.map((b) => `<dt>${esc(b.salary_component)}</dt><dd>${money(b.amount)}</dd>`).join("")}</dl>` : empty(__("None")));
				kpis.push(kpi(__("Last net pay"), last ? money(last.net_pay) : "-", last ? day(last.start_date) : __("No salary slips")));
				kpis.push(kpi(__("Deductions this year"), money(d.last_slip.ytd.deduction), `${d.last_slip.ytd.slips} ${__("slips")}`));
				panels.push(
					panel(
						__("Last salary slip"),
						last
							? `<div class="efs-sub">${__("Earnings")}</div>${kv(part("earnings"))}<div class="efs-sub">${__("Deductions")}</div>${kv(part("deductions"))}<div class="efs-note">${link("Salary Slip", last.name)}</div>`
							: empty(__("No salary slips"))
					)
				);
			}

			if (shown(d.slips)) panels.push(panel(__("Recent salary slips"), paged("slips", d.slips)));

			const dues = [d.loans, d.advances].filter(shown);
			if (dues.length) {
				const due = dues.reduce((sum, s) => sum + (s.balance || 0), 0);
				const count = dues.reduce((sum, s) => sum + (s.count || 0), 0);
				kpis.push(kpi(__("Loans and advances due"), money(due), `${count} ${__("records")}`));
				panels.push(
					panel(
						__("Loans and advances"),
						(shown(d.loans) ? `<div class="efs-sub">${__("Loans")}</div>${paged("loans", d.loans)}` : "") +
							(shown(d.advances) ? `<div class="efs-sub">${__("Advances")}</div>${paged("advances", d.advances)}` : "")
					)
				);
			}

			if (shown(d.eos) || shown(d.eos_records)) {
				const est = shown(d.eos) ? d.eos.estimate : null;
				if (shown(d.eos)) kpis.push(kpi(__("End of service estimate"), est ? money(est.amount) : "-", est ? `${est.years} ${__("years")}` : ""));
				const estimate = shown(d.eos)
					? est
						? `<dl class="efs-kv"><dt>${__("Service years")}</dt><dd>${est.years}</dd><dt>${__("Wage basis")}</dt><dd>${money(est.wage)}</dd><dt>${__("Daily wage")}</dt><dd>${money(est.per_day)}</dd><dt>${__("End of service days")}</dt><dd>${est.eos_days}</dd><dt class="efs-total">${__("Estimate")}</dt><dd class="efs-total">${money(est.amount)}</dd></dl><div class="efs-note">${__("Contract end estimate as of {0}", [day(est.as_of)])}</div>`
						: empty(__("No estimate"))
					: "";
				const records = shown(d.eos_records) ? `<div class="efs-sub">${__("End of service settlements")}</div>${paged("eos_records", d.eos_records)}` : "";
				panels.push(panel(__("End of service"), estimate + records));
			}

			if (shown(d.leave_balance) || shown(d.vacation_records)) {
				panels.push(
					panel(
						__("Leave and vacation"),
						(shown(d.leave_balance) ? `<div class="efs-sub">${__("Leave balance")}</div>${paged("leave_balance", d.leave_balance)}` : "") +
							(shown(d.vacation_records) ? `<div class="efs-sub">${__("Advance Leave Salaries")}</div>${paged("vacation_records", d.vacation_records)}` : "")
					)
				);
			}

			if (shown(d.ledger)) panels.push(panel(__("Ledger balances"), paged("ledger", d.ledger)));

			if (shown(d.requisitions)) {
				const r = d.requisitions;
				panels.push(
					panel(
						__("Payment requisitions"),
						r.account_no
							? `<dl class="efs-kv"><dt>${__("Paid total")}</dt><dd>${money(r.paid)}</dd></dl><div class="efs-sub">${__("Latest")}</div>${paged("requisitions", r)}`
							: empty(__("No bank account on the employee"))
					)
				);
			}

			body.html(head + (kpis.length ? `<div class="efs-kpis">${kpis.join("")}</div>` : "") + (panels.length ? `<div class="efs-grid">${panels.join("")}</div>` : ""));
		}

		function load() {
			const employee = frm.efs_employee;
			body.html(empty(__("Loading...")));
			frappe
				.xcall("afmco.people_and_payroll.api.employee_financial_summary.get_employee_financial_summary", { employee })
				.then((r) => {
					if (employee === frm.efs_employee) render(r);
				})
				.catch(() => body.html(empty(__("Could not load the summary"))));
		}

		if (frm.efs_employee) {
			load();
		} else {
			body.html(empty(__("Select an employee to see the summary")));
		}
	},
});

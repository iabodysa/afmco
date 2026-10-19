// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

const BOT_BUSY_STATUSES = ['Queued', 'Processing'];
const BOT_FINAL_STATUSES = ['Needs Review', 'Done', 'Failed', 'Stopped'];
const BOT_STATUS_COLORS = {
    Draft: 'gray',
    Queued: 'blue',
    Processing: 'orange',
    'Needs Review': 'yellow',
    Done: 'green',
    Failed: 'red',
    Stopped: 'gray',
};

frappe.ui.form.on('Client Timesheet', {
    refresh(frm) {
        renderBotPanel(frm);
        if (frm.is_new() || !frm.perm[0]?.write || BOT_BUSY_STATUSES.includes(frm.doc.bot_status)) {
            return;
        }
        frm.add_custom_button(__('Start Payroll Bot'), () => {
            frappe.confirm(__('Send this timesheet to the Payroll Bot?'), async () => {
                if (frm.is_dirty()) {
                    await frm.save();
                }
                await frappe.call({
                    method: 'afmco.people_and_payroll.api.client_timesheet.start_payroll_bot',
                    args: { name: frm.doc.name },
                    freeze: true,
                });
                frappe.show_alert({ message: __('Sent to the Payroll Bot.'), indicator: 'green' });
                frm.reload_doc();
            });
        }).addClass('btn-primary');
    },
});

function renderBotPanel(frm) {
    frm.dashboard.parent.find('.cts-dash-section').remove();
    if (frm.is_new()) {
        return;
    }
    const body = frm.dashboard.add_section(buildBotPanelHtml(frm), __('Payroll Bot'));
    body.closest('.form-dashboard-section').addClass('cts-dash-section');
    body.on('click', '.cts-log-link', () => showBotLog(frm));
    frm.dashboard.show();
    loadResultDetails(frm, body);
}

const esc = (value) => frappe.utils.escape_html(String(value ?? ''));
const ltr = (value) => `<span dir="ltr">${esc(value)}</span>`;
const userName = (user) => esc(frappe.user_info(user).fullname || user);

function pill(status) {
    const color = BOT_STATUS_COLORS[status] || 'gray';
    const dot = status === 'Processing' ? '<span class="cts-dot"></span>' : '';
    return `<span class="indicator-pill whitespace-nowrap ${color}">${dot}<span>${esc(__(status))}</span></span>`;
}

function tile(label, value, alert) {
    return `<div class="cts-tile${alert ? ' cts-tile-alert' : ''}">
        <div class="cts-tile-value">${ltr(format_number(cint(value), null, 0))}</div>
        <div class="cts-tile-label">${esc(label)}</div>
    </div>`;
}

function chip(label, ok, busy) {
    const [state, mark, title] = ok ? ['ok', '✓', __('Yes')] : busy ? ['wait', '…', __('Pending')] : ['bad', '✕', __('No')];
    return `<span class="cts-chip cts-chip-${state}" title="${esc(title)}"><b>${mark}</b> ${esc(label)}</span>`;
}

function stepper(status) {
    const finalLabel = BOT_FINAL_STATUSES.includes(status) ? __(status) : __('Result');
    const current = BOT_FINAL_STATUSES.includes(status) ? 3 : Math.max(['Draft', 'Queued', 'Processing'].indexOf(status), 0);
    const steps = [__('Draft'), __('Queued'), __('Processing'), finalLabel].map((label, index) => {
        let state = index < current ? 'done' : index === current ? `now ${BOT_STATUS_COLORS[status] || 'gray'}` : 'next';
        if (status === 'Done') state = 'done';
        return `<li class="cts-step cts-step-${state}"><span>${esc(label)}</span></li>`;
    });
    return `<ol class="cts-stepper">${steps.join('')}</ol>`;
}

function trackLine(label, user, when) {
    if (!user && !when) return '';
    const parts = [user ? userName(user) : '', when ? ltr(frappe.datetime.str_to_user(when)) : ''].filter(Boolean);
    return `<div>${esc(label)}: ${parts.join(' · ')}</div>`;
}

function details(label, text) {
    if (!text) return '';
    return `<details class="cts-details"><summary>${esc(label)}</summary><div class="cts-pre">${esc(text)}</div></details>`;
}

function buildBotPanelHtml(frm) {
    const doc = frm.doc;
    const status = doc.bot_status || 'Draft';
    const busy = BOT_BUSY_STATUSES.includes(status);
    const parts = [];

    parts.push(`<div class="cts-head">
        <div class="cts-head-main">${pill(status)}${stepper(status)}</div>
        <div class="cts-track">
            ${trackLine(__('Sent to Bot By'), doc.queued_by, doc.queued_on)}
            ${trackLine(__('Processed By'), doc.processed_by, doc.processed_on)}
        </div>
    </div>`);

    if (status === 'Draft' && !doc.queued_on) {
        parts.push(`<div class="cts-hint">${esc(__('Attach the client timesheet file and save, then press Start Payroll Bot.'))}</div>`);
    } else if (busy) {
        parts.push(`<div class="cts-hint">${esc(__('The Payroll Bot is already working on this timesheet.'))}</div>`);
    }

    if (doc.error) {
        parts.push(`<div class="cts-alert cts-alert-red"><div class="cts-alert-title">${esc(__('Problem'))}</div><div class="cts-pre">${esc(doc.error)}</div></div>`);
    }
    if (doc.missing_rules) {
        parts.push(`<div class="cts-alert cts-alert-yellow"><div class="cts-alert-title">${esc(__('Missing Pay Rules'))}</div><div class="cts-pre">${esc(doc.missing_rules)}</div></div>`);
    }

    if (status !== 'Draft') {
        parts.push(`<div class="cts-chips">
            ${chip(__('File Format Checked'), doc.format_ok, busy)}
            ${chip(__('Pay Rules Found'), doc.rules_ok, busy)}
            ${chip(__('Totals Match'), doc.totals_ok, busy)}
        </div>`);
    }

    if (doc.rows_read || doc.employees_count || doc.invoice_lines) {
        parts.push(`<div class="cts-grid">
            ${tile(__('Rows Read'), doc.rows_read)}
            ${tile(__('Employees'), doc.employees_count)}
            ${tile(__('Invoice Lines'), doc.invoice_lines)}
        </div>`);
    }

    if (['Needs Review', 'Done'].includes(status) || doc.sales_invoice || doc.payment_requisition || doc.salary_excel) {
        const empty = `<div class="cts-muted">${esc(__('Not created yet'))}</div>`;
        const si = doc.sales_invoice
            ? `${frappe.utils.get_form_link('Sales Invoice', doc.sales_invoice, true)}<div class="cts-muted cts-si-meta"></div>`
            : empty;
        const pr = doc.payment_requisition
            ? `${frappe.utils.get_form_link('Payment Requisition', doc.payment_requisition, true)}<div class="cts-muted cts-pr-meta"></div>`
            : empty;
        const sheet = doc.salary_excel
            ? `<a href="${esc(doc.salary_excel)}" target="_blank" rel="noopener">${esc(__('Download'))}</a>`
            : empty;
        parts.push(`<div class="cts-grid">
            <div class="cts-card"><div class="cts-card-label">${esc(__('Sales Invoice'))}</div>${si}</div>
            <div class="cts-card"><div class="cts-card-label">${esc(__('Payment Requisition'))}</div>${pr}</div>
            <div class="cts-card"><div class="cts-card-label">${esc(__('Salary Sheet'))}</div>${sheet}</div>
        </div>`);
    }

    const attendanceCounts = [doc.attendance_proposed, doc.attendance_created, doc.attendance_skipped_existing, doc.unmatched_employees];
    if (doc.attendance_ok || attendanceCounts.some((n) => cint(n) > 0) || doc.unmatched_list || doc.attendance_errors || doc.attendance_reviewed_by) {
        const badge = `<span class="indicator-pill ${doc.attendance_ok ? 'green' : 'red'}"><span>${esc(__('Attendance Drafted OK'))}: ${esc(doc.attendance_ok ? __('Yes') : __('No'))}</span></span>`;
        const reviewed = doc.attendance_reviewed_by ? `<span class="cts-muted">${esc(__('Reviewed By'))}: ${userName(doc.attendance_reviewed_by)}</span>` : '';
        parts.push(`<div class="cts-block">
            <div class="cts-block-head"><span class="cts-block-title">${esc(__('Attendance'))}</span>${badge}${reviewed}</div>
            <div class="cts-grid">
                ${tile(__('Attendance Proposed'), doc.attendance_proposed)}
                ${tile(__('Attendance Created'), doc.attendance_created)}
                ${tile(__('Attendance Skipped (Existing)'), doc.attendance_skipped_existing)}
                ${tile(__('Unmatched Employees'), doc.unmatched_employees, cint(doc.unmatched_employees) > 0)}
            </div>
            ${details(__('Unmatched Employee List'), doc.unmatched_list)}
            ${details(__('Attendance Errors'), doc.attendance_errors)}
        </div>`);
    }

    if (doc.bot_log) {
        parts.push(`<div><button type="button" class="btn btn-link btn-xs cts-log-link">${esc(__('Show Bot Log'))}</button></div>`);
    }

    return `<div class="cts-panel">${panelStyle()}${parts.join('')}</div>`;
}

function loadResultDetails(frm, body) {
    const seq = (frm._cts_dash_seq = (frm._cts_dash_seq || 0) + 1);
    const { sales_invoice, payment_requisition } = frm.doc;
    const docstatusLabels = [__('Draft'), __('Submitted'), __('Cancelled')];
    const fetchIf = (doctype, name, fields) =>
        name && frappe.model.can_read(doctype)
            ? frappe.db.get_value(doctype, name, fields).then((r) => r.message).catch(() => null)
            : Promise.resolve(null);
    Promise.all([
        fetchIf('Sales Invoice', sales_invoice, ['status', 'grand_total', 'currency']),
        fetchIf('Payment Requisition', payment_requisition, ['amount', 'docstatus']),
    ]).then(([si, pr]) => {
        if (seq !== frm._cts_dash_seq) return;
        if (si) {
            body.find('.cts-si-meta').html(`${esc(__(si.status))} · ${ltr(format_currency(si.grand_total, si.currency))}`);
        }
        if (pr) {
            body.find('.cts-pr-meta').html(`${ltr(format_currency(pr.amount))} · ${esc(docstatusLabels[cint(pr.docstatus)] || '')}`);
        }
    });
}

function showBotLog(frm) {
    frappe.msgprint({
        title: __('Bot Log'),
        message: `<pre dir="ltr" style="max-height:60vh;overflow:auto;white-space:pre-wrap">${esc(frm.doc.bot_log)}</pre>`,
        wide: true,
    });
}

function panelStyle() {
    return `<style>
        .cts-panel { display: flex; flex-direction: column; gap: 12px; padding-block: 4px; }
        .cts-head { display: flex; flex-wrap: wrap; gap: 12px; justify-content: space-between; align-items: flex-start; }
        .cts-head-main { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; min-width: 0; }
        .cts-track { font-size: var(--text-xs); color: var(--text-muted); text-align: start; }
        .cts-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: currentColor; margin-inline-end: 6px; animation: cts-pulse 1.2s ease-in-out infinite; }
        @keyframes cts-pulse { 50% { opacity: .3; } }
        @media (prefers-reduced-motion: reduce) { .cts-dot { animation: none; } }
        .cts-stepper { display: flex; list-style: none; margin: 0; padding: 0; overflow-x: auto; max-width: 100%; }
        .cts-step { position: relative; display: flex; align-items: center; white-space: nowrap; font-size: var(--text-xs); }
        .cts-step + .cts-step::before { content: ""; display: inline-block; width: 16px; height: 2px; margin-inline: 4px; background: var(--border-color); }
        .cts-step span { padding: 2px 10px; border-radius: var(--border-radius-lg); }
        .cts-step-done span { background: var(--bg-green); color: var(--text-on-green); }
        .cts-step-next span { background: var(--bg-gray); color: var(--text-muted); }
        .cts-step-now span { font-weight: var(--weight-semibold); }
        .cts-step-now.gray span { background: var(--bg-gray); color: var(--text-on-gray); }
        .cts-step-now.blue span { background: var(--bg-blue); color: var(--text-on-blue); }
        .cts-step-now.orange span { background: var(--bg-orange); color: var(--text-on-orange); }
        .cts-step-now.yellow span { background: var(--bg-yellow); color: var(--text-on-yellow); }
        .cts-step-now.green span { background: var(--bg-green); color: var(--text-on-green); }
        .cts-step-now.red span { background: var(--bg-red); color: var(--text-on-red); }
        .cts-hint, .cts-muted { color: var(--text-muted); font-size: var(--text-sm); }
        .cts-alert { padding: 8px 12px; border-radius: var(--border-radius-md); font-size: var(--text-sm); }
        .cts-alert-red { background: var(--bg-red); color: var(--text-on-red); }
        .cts-alert-yellow { background: var(--bg-yellow); color: var(--text-on-yellow); }
        .cts-alert-title { font-weight: var(--weight-semibold); margin-bottom: 4px; }
        .cts-pre { white-space: pre-wrap; overflow-wrap: anywhere; }
        .cts-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .cts-chip { padding: 2px 10px; border-radius: var(--border-radius-lg); font-size: var(--text-xs); }
        .cts-chip-ok { background: var(--bg-green); color: var(--text-on-green); }
        .cts-chip-bad { background: var(--bg-red); color: var(--text-on-red); }
        .cts-chip-wait { background: var(--bg-gray); color: var(--text-muted); }
        .cts-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; }
        .cts-tile, .cts-card { background: var(--control-bg); border-radius: var(--border-radius-md); padding: 10px 12px; text-align: start; min-width: 0; overflow-wrap: anywhere; }
        .cts-tile-alert { background: var(--bg-red); color: var(--text-on-red); }
        .cts-tile-value { font-size: var(--text-2xl); font-weight: var(--weight-semibold); color: var(--heading-color); }
        .cts-tile-alert .cts-tile-value { color: inherit; }
        .cts-tile-label, .cts-card-label { font-size: var(--text-xs); color: var(--text-muted); }
        .cts-tile-alert .cts-tile-label { color: inherit; }
        .cts-block { display: flex; flex-direction: column; gap: 8px; }
        .cts-block-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
        .cts-block-title { font-weight: var(--weight-semibold); color: var(--heading-color); }
        .cts-details summary { cursor: pointer; font-size: var(--text-sm); }
        .cts-details .cts-pre { padding-block: 6px; font-size: var(--text-sm); }
    </style>`;
}

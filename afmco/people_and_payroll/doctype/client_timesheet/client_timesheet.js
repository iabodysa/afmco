// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

const BOT_BUSY_STATUSES = [
    'Queued',
    'Reading File',
    'File Read',
    'Checking Rules',
    'Building Invoice',
    'Building Salary',
    'Comparing',
    'Drafts Created',
];
const BOT_HALT_STATUSES = ['Blocked', 'Failed', 'Stopped'];
const BOT_STATUS_COLORS = {
    Draft: 'gray',
    Queued: 'blue',
    'Needs Review': 'yellow',
    Blocked: 'red',
    Failed: 'red',
    Done: 'green',
    Stopped: 'gray',
};
const CHIP_TONES = { gray: 'plain', blue: 'blue', yellow: 'amber', orange: 'amber', red: 'red', green: 'green' };
const SHEET_ASSETS = [
    '/assets/afmco/js/stepper.js',
    '/assets/afmco/css/stepper.css',
    '/assets/afmco/css/payment_requisition_summary.css',
    '/assets/afmco/css/client_timesheet.css',
];
const MAX_GRID_DAYS = 62;
const FRIDAY = 5;
const statusColor = (status) => BOT_STATUS_COLORS[status] || (BOT_BUSY_STATUSES.includes(status) ? 'orange' : 'gray');

frappe.ui.form.on('Client Timesheet', {
    on_hide(frm) {
        stopPayrollBotStatus(frm);
    },

    refresh(frm) {
        renderBotPanel(frm);
        listenPayrollBotStatus(frm);
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
    ...Object.fromEntries(['customer', 'project', 'from_date', 'to_date', 'timesheet_file', 'notes'].map((event) => [event, renderBotPanel])),
});

function stopPayrollBotStatus(frm) {
    if (frm.payrollBotStatusHandler) {
        frappe.realtime.off('payroll_bot_status', frm.payrollBotStatusHandler);
    }
}

function listenPayrollBotStatus(frm) {
    stopPayrollBotStatus(frm);
    frm.payrollBotStatusHandler = (data) => {
        if (!data || data.name !== frm.doc.name) return;
        if (frm.is_dirty()) {
            frm.doc.bot_status = data.status;
            frm.doc.bot_note = data.note;
            renderBotPanel(frm);
            return;
        }
        frm.debounced_reload_doc();
    };
    frappe.realtime.on('payroll_bot_status', frm.payrollBotStatusHandler);
}

function renderBotPanel(frm) {
    frappe.require(SHEET_ASSETS, () => {
        frm.dashboard.parent.find('.cts-dash-section').remove();
        if (frm.is_new()) {
            return;
        }
        const body = frm.dashboard.add_section(buildBotPanelHtml(frm), __('Client Timesheet'));
        body.closest('.form-dashboard-section').addClass('cts-dash-section');
        body.on('click', '.cts-log-link', () => showBotLog(frm));
        frm.dashboard.show();
        afmco.stepper.center(body);
        loadResultDetails(frm, body);
    });
}

const esc = (value) => frappe.utils.escape_html(String(value ?? ''));
const ltr = (value, cls = '') => `<span class="prc-ltr prc-num ${cls}">${esc(value)}</span>`;
const userName = (user) => esc(frappe.user_info(user).fullname || user);
const dash = '<span class="prc-empty">—</span>';
const count = (value) => (cint(value) ? ltr(format_number(cint(value), null, 0)) : dash);

function chip(status) {
    const tone = CHIP_TONES[statusColor(status)];
    const live = BOT_BUSY_STATUSES.includes(status) ? ' cts-live' : '';
    return `<span class="prc-chip prc-chip--${tone}${live}">${esc(__(status))}</span>`;
}

function stepper(frm, status) {
    const stages = [...BOT_BUSY_STATUSES, status === 'Needs Review' ? status : 'Done'];
    const halted = BOT_HALT_STATUSES.includes(status);
    let current = stages.indexOf(status);
    if (halted) {
        const at = stages.indexOf(afmco.stepper.value_before(frm, 'bot_status', status));
        current = at >= 0 ? at : stages.length - 1;
    }
    if (status === 'Done') current = stages.length;
    return {
        stages,
        current,
        html: afmco.stepper.html({
            stages,
            current,
            color: statusColor(status),
            halted,
            live: BOT_BUSY_STATUSES.includes(status),
        }),
    };
}

function periodDays(doc) {
    if (!doc.from_date || !doc.to_date) return [];
    const from = frappe.datetime.str_to_obj(doc.from_date);
    const to = frappe.datetime.str_to_obj(doc.to_date);
    const days = [];
    for (const day = new Date(from); day <= to && days.length <= MAX_GRID_DAYS; day.setDate(day.getDate() + 1)) {
        days.push(new Date(day));
    }
    return days;
}

function flowHtml(frm, status) {
    const flow = stepper(frm, status);
    const busy = BOT_BUSY_STATUSES.includes(status);
    const halted = BOT_HALT_STATUSES.includes(status);
    const step = !halted && flow.current >= 0 && flow.current < flow.stages.length
        ? `<span>${esc(__('Step {0} of {1}', [flow.current + 1, flow.stages.length]))}</span>`
        : '';
    let hint = '';
    if (status === 'Draft' && !frm.doc.queued_on) {
        hint = __('Attach the client timesheet file and save, then press Start Payroll Bot.');
    } else if (busy) {
        hint = __('The Payroll Bot is already working on this timesheet.');
    }
    return `<section class="prc-flow" aria-label="${esc(__('Payroll Bot'))}">
        <div class="prc-flow__head"><b>${esc(__('Payroll Bot'))}</b>${step}${chip(status)}</div>
        ${flow.html}
        ${frm.doc.bot_note ? `<div class="cts-note" dir="auto">${esc(frm.doc.bot_note)}</div>` : ''}
        ${hint ? `<div class="cts-hint">${esc(hint)}</div>` : ''}
    </section>`;
}

function dayGridHtml(days) {
    if (!days.length || days.length > MAX_GRID_DAYS) return '';
    const weekday = new Intl.DateTimeFormat(frappe.boot.lang || 'en', { weekday: 'narrow' });
    const cells = days
        .map((day) => {
            const off = day.getDay() === FRIDAY ? ' is-off' : '';
            const first = day.getDate() === 1 ? ' is-month' : '';
            return `<li class="cts-day${off}${first}"><small>${esc(weekday.format(day))}</small><b>${day.getDate()}</b></li>`;
        })
        .join('');
    return `<div class="cts-days">
        <ol class="cts-daygrid" aria-label="${esc(__('Period'))}">${cells}</ol>
        <div class="cts-legend"><span class="cts-swatch"></span>${esc(__('Friday'))}</div>
    </div>`;
}

function checksHtml(doc, status) {
    if (status === 'Draft') return '';
    const busy = BOT_BUSY_STATUSES.includes(status);
    const box = (label, ok) => {
        const [state, mark] = ok ? ['ok', '✓'] : busy ? ['wait', ''] : ['bad', '✕'];
        return `<span class="cts-check cts-check--${state}"><span class="cts-box" aria-hidden="true">${mark}</span>${esc(label)}</span>`;
    };
    return `<div class="cts-checks"><span class="prc-label">${esc(__('Payroll Bot checks'))}</span>
        ${box(__('File Format Checked'), doc.format_ok)}
        ${box(__('Pay Rules Found'), doc.rules_ok)}
        ${box(__('Totals Match'), doc.totals_ok)}
    </div>`;
}

function signHtml(label, user, when) {
    const stamp = when ? `<div class="cts-sign__when">${ltr(frappe.datetime.str_to_user(when))}</div>` : '';
    return `<div class="cts-sign__box"><div class="prc-label">${esc(label)}</div><div class="cts-sign__name">${user ? userName(user) : dash}</div>${stamp}</div>`;
}

function sheetHtml(frm, status) {
    const doc = frm.doc;
    const days = periodDays(doc);
    const dayCount = doc.from_date && doc.to_date ? Math.max(frappe.datetime.get_day_diff(doc.to_date, doc.from_date) + 1, 0) : 0;
    const date = (value) => (value ? ltr(frappe.datetime.str_to_user(value)) : dash);
    const file = doc.timesheet_file
        ? `<a href="${esc(doc.timesheet_file)}" target="_blank" rel="noopener" class="prc-ltr">${esc(doc.timesheet_file.split('/').pop())}</a>`
        : dash;
    const notes = doc.notes ? `<div class="cts-notes"><span class="prc-label">${esc(__('Notes'))}</span><bdi dir="auto">${esc(doc.notes)}</bdi></div>` : '';
    return `<section class="cts-sheet" aria-label="${esc(__('Client Timesheet'))}">
        <div class="cts-sheet__head">
            <div class="cts-who">
                <div class="cts-kind">${esc(__('Client Timesheet'))} <span class="prc-mono">${esc(doc.name)}</span></div>
                <div class="cts-customer"><bdi dir="auto">${esc(doc.customer || '')}</bdi></div>
                <div class="cts-project"><span class="prc-label">${esc(__('Project'))}</span> <bdi dir="auto">${esc(doc.project || '')}</bdi></div>
            </div>
            <div class="cts-period">
                <span class="prc-label">${esc(__('Period'))}</span>
                <b>${dayCount ? esc(__('{0} days', [dayCount])) : '—'}</b>
                <div class="cts-period__range"><span>${esc(__('From Date'))}</span> ${date(doc.from_date)}</div>
                <div class="cts-period__range"><span>${esc(__('To Date'))}</span> ${date(doc.to_date)}</div>
            </div>
        </div>
        ${dayGridHtml(days)}
        <div class="cts-totals">
            <div class="cts-total"><span>${esc(__('Employees'))}</span><b>${count(doc.employees_count)}</b></div>
            <div class="cts-total"><span>${esc(__('Rows Read'))}</span><b>${count(doc.rows_read)}</b></div>
            <div class="cts-total"><span>${esc(__('Invoice Lines'))}</span><b>${count(doc.invoice_lines)}</b></div>
            <div class="cts-total"><span>${esc(__('Days'))}</span><b>${count(dayCount)}</b></div>
        </div>
        ${checksHtml(doc, status)}
        <div class="cts-meta"><div><span class="prc-label">${esc(__('Timesheet File'))}</span> ${file}</div>${notes}</div>
        <div class="cts-sign">
            ${signHtml(__('Sent to Bot By'), doc.queued_by, doc.queued_on)}
            ${signHtml(__('Processed By'), doc.processed_by, doc.processed_on)}
            ${signHtml(__('Reviewed By'), doc.attendance_reviewed_by)}
        </div>
    </section>`;
}

function alertsHtml(doc) {
    const alert = (tone, title, text) =>
        text ? `<div class="cts-alert cts-alert--${tone}"><div class="cts-alert__title">${esc(title)}</div><div class="cts-pre">${esc(text)}</div></div>` : '';
    return alert('red', __('Problem'), doc.error) + alert('amber', __('Missing Pay Rules'), doc.missing_rules);
}

function card(title, body, badge = '') {
    return `<section class="prc-card"><div class="prc-card__head"><h3 class="prc-card__title">${esc(title)}</h3>${badge}</div><div class="prc-card__body">${body}</div></section>`;
}

function resultsHtml(doc, status) {
    const shown = ['Needs Review', 'Done'].includes(status) || doc.sales_invoice || doc.payment_requisition || doc.salary_excel;
    const log = doc.bot_log ? `<button type="button" class="prc-goform cts-log-link">${esc(__('Show Bot Log'))}</button>` : '';
    if (!shown && !log) return '';
    const empty = `<span class="prc-empty">${esc(__('Not created yet'))}</span>`;
    const row = (label, value) => `<div class="cts-out__row"><span class="prc-label">${esc(label)}</span><div class="cts-out__val">${value}</div></div>`;
    const si = doc.sales_invoice
        ? `${frappe.utils.get_form_link('Sales Invoice', doc.sales_invoice, true)}<div class="cts-out__meta cts-si-meta"></div>`
        : empty;
    const pr = doc.payment_requisition
        ? `${frappe.utils.get_form_link('Payment Requisition', doc.payment_requisition, true)}<div class="cts-out__meta cts-pr-meta"></div>`
        : empty;
    const sheet = doc.salary_excel ? `<a href="${esc(doc.salary_excel)}" target="_blank" rel="noopener">${esc(__('Download'))}</a>` : empty;
    const rows = shown
        ? `<div class="cts-out">${row(__('Sales Invoice'), si)}${row(__('Payment Requisition'), pr)}${row(__('Salary Sheet'), sheet)}</div>`
        : '';
    return card(__('Results'), rows + log);
}

function attendanceHtml(doc) {
    const counts = [doc.attendance_proposed, doc.attendance_created, doc.attendance_skipped_existing, doc.unmatched_employees];
    if (!(doc.attendance_ok || counts.some((n) => cint(n) > 0) || doc.unmatched_list || doc.attendance_errors || doc.attendance_reviewed_by)) {
        return '';
    }
    const tile = (label, value, alert) =>
        `<div class="cts-tile${alert ? ' is-alert' : ''}"><b>${ltr(format_number(cint(value), null, 0))}</b><span>${esc(label)}</span></div>`;
    const details = (label, text) =>
        text ? `<details class="cts-details"><summary>${esc(label)}</summary><div class="cts-pre">${esc(text)}</div></details>` : '';
    const badge = `<span class="prc-chip prc-chip--${doc.attendance_ok ? 'green' : 'red'}">${esc(__('Attendance Drafted OK'))}: ${esc(doc.attendance_ok ? __('Yes') : __('No'))}</span>`;
    const body = `<div class="cts-tiles">
            ${tile(__('Attendance Proposed'), doc.attendance_proposed)}
            ${tile(__('Attendance Created'), doc.attendance_created)}
            ${tile(__('Attendance Skipped (Existing)'), doc.attendance_skipped_existing)}
            ${tile(__('Unmatched Employees'), doc.unmatched_employees, cint(doc.unmatched_employees) > 0)}
        </div>
        ${details(__('Unmatched Employee List'), doc.unmatched_list)}
        ${details(__('Attendance Errors'), doc.attendance_errors)}`;
    return card(__('Attendance'), body, badge);
}

function buildBotPanelHtml(frm) {
    const doc = frm.doc;
    const status = doc.bot_status || 'Draft';
    const aside = resultsHtml(doc, status) + attendanceHtml(doc);
    return `<div class="afmco-pr-summary afmco-cts">
        <div class="cts-layout${aside ? '' : ' no-aside'}">
            ${flowHtml(frm, status)}
            <div class="cts-main">${alertsHtml(doc)}${sheetHtml(frm, status)}</div>
            ${aside ? `<aside class="cts-aside">${aside}</aside>` : ''}
        </div>
    </div>`;
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
        message: `<pre dir="ltr" class="cts-log">${esc(frm.doc.bot_log)}</pre>`,
        wide: true,
    });
}

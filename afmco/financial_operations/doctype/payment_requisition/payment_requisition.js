// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.ui.form.on('Payment Requisition', {
	setup: function (frm) {
		frm.set_query('payment_approver', () => ({
			query: 'afmco.financial_operations.api.payment_approver.active_approvers',
		}))
	},
});

/** Client script for Payment Requisition. */

// Shared helpers ---------------------------------------------------------------
const user_language = frappe.boot.user.language || 'en';
const isRTL = user_language === 'ar';
const JOURNAL_ENTRY_PAYMENT_TYPES = Object.freeze(['EOS', 'Advance Leave Salary', 'SADAD Payment']);

function escapeHtml(value) {
    return frappe.utils.escape_html(value === null || value === undefined ? '' : String(value));
}

function escapeHtmlWithLineBreaks(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function fetchListRecords(doctype, args = {}) {
    return frappe.xcall('frappe.desk.reportview.get_list', {
        doctype,
        ...args
    });
}

function build_afmco_table(headers_html, rows_html, tfoot_html = '') {
    return `
        <div class="table-responsive">
            <table class="table table-bordered text-muted" style="font-size: 13px;">
                ${headers_html ? `<thead style="background-color: var(--control-bg);"><tr>${headers_html}</tr></thead>` : ''}
                <tbody>
                    ${rows_html}
                </tbody>
                ${tfoot_html ? `<tfoot>${tfoot_html}</tfoot>` : ''}
            </table>
        </div>
    `;
}

function build_afmco_alert(type, message, icon, messageIsSafeHtml = false) {
    const safeType = escapeHtml(type);
    const safeIcon = escapeHtml(icon);
    const safeMessage = messageIsSafeHtml ? String(message) : escapeHtml(message);

    return `
        <div class="alert alert-${safeType} form-message d-flex align-items-center mb-3">
            <i class="fa ${safeIcon} mx-2 text-${safeType}"></i>
            <div>${safeMessage}</div>
        </div>
    `;
}

const AFMCO_SECTION_STORAGE_PREFIX = 'afmco-dashboard-section';

function getAfmcoSectionStorageKey(sectionKey) {
    const user = (frappe.session && frappe.session.user) || 'Guest';
    return `${AFMCO_SECTION_STORAGE_PREFIX}:${user}:${sectionKey}`;
}

function getAfmcoSectionCollapsed(sectionKey, collapsedByDefault) {
    try {
        const storedState = localStorage.getItem(getAfmcoSectionStorageKey(sectionKey));
        if (storedState === 'collapsed') return true;
        if (storedState === 'expanded') return false;
    } catch (error) {
        // Keep the default when storage is unavailable.
    }

    return Boolean(collapsedByDefault);
}

function saveAfmcoSectionCollapsed(sectionKey, collapsed) {
    try {
        localStorage.setItem(
            getAfmcoSectionStorageKey(sectionKey),
            collapsed ? 'collapsed' : 'expanded'
        );
    } catch (error) {
        // The dashboard remains usable when storage is unavailable.
    }
}

function getAfmcoDashboardContainer(frm) {
    const firstElement = candidate => {
        try {
            if (!candidate || !candidate.length || typeof candidate.first !== 'function') return null;
            const $first = candidate.first();
            if (
                !$first ||
                !$first.length ||
                typeof $first.first !== 'function' ||
                typeof $first.find !== 'function' ||
                typeof $first.append !== 'function' ||
                typeof $first.prepend !== 'function'
            ) {
                return null;
            }
            return $first;
        } catch (error) {
            return null;
        }
    };

    const dashboard = frm && frm.dashboard;
    const dashboardCandidates = dashboard ? [dashboard.parent, dashboard.wrapper] : [];
    for (const candidate of dashboardCandidates) {
        const $candidate = firstElement(candidate);
        if ($candidate) return $candidate;
    }

    const scopedRoots = [frm && frm.wrapper, frm && frm.page && frm.page.body];
    for (const root of scopedRoots) {
        const $root = firstElement(root);
        if (!$root || typeof $root.find !== 'function') continue;

        try {
            const $dashboard = firstElement($root.find('.form-dashboard'));
            if ($dashboard) return $dashboard;
        } catch (error) {
            // Skip malformed roots and continue to the next scoped candidate.
        }
    }

    return null;
}

function removeAfmcoDashboardSections(frm, selector) {
    const $container = getAfmcoDashboardContainer(frm);
    if (!$container || !selector || typeof $container.find !== 'function') return;

    let $targets;
    try {
        $targets = $container.find(selector);
    } catch (error) {
        return;
    }
    if (!$targets || typeof $targets.each !== 'function') return;

    $targets.each(function() {
        const $target = $(this);
        if ($target.hasClass('custom')) {
            $target.remove();
            return;
        }

        const $outer = $target
            .parentsUntil($container, '.form-dashboard-section.custom, .form-section.custom')
            .first();
        if ($outer.length) {
            $outer.remove();
        } else {
            $target.remove();
        }
    });
}

function appendAfmcoDashboardSection(frm, html) {
    const $container = getAfmcoDashboardContainer(frm);
    if (!$container || typeof $container.append !== 'function') return null;

    let $section;
    try {
        const $elements = $(html);
        if (!$elements || !$elements.length || typeof $elements.first !== 'function') return null;
        $section = $elements.first();
    } catch (error) {
        return null;
    }

    if (!$section || !$section.length) return null;
    $container.append($section);
    if (frm && frm.dashboard && typeof frm.dashboard.show === 'function') {
        frm.dashboard.show();
    } else {
        $container.addClass('visible-section').removeClass('empty-section hidden');
    }
    return $section;
}

function buildAfmcoCollapsibleSection({
    sectionKey,
    title,
    meta = '',
    bodyHtml,
    wrapperClass = '',
    bodyClass = '',
    collapsedByDefault = false
}) {
    const collapsed = getAfmcoSectionCollapsed(sectionKey, collapsedByDefault);
    const safeSectionKey = escapeHtml(sectionKey);
    const safeTitle = escapeHtml(title);
    const safeMeta = escapeHtml(meta);
    const safeWrapperClass = wrapperClass ? ` ${escapeHtml(wrapperClass)}` : '';
    const safeBodyClass = bodyClass ? ` ${escapeHtml(bodyClass)}` : '';
    const bodyId = `afmco-section-body-${String(sectionKey).replace(/[^A-Za-z0-9_-]/g, '-')}`;

    return `
        <div class="row form-section card-section${safeWrapperClass}">
            <div
                class="section-head collapsible${collapsed ? ' collapsed' : ''} afmco-dashboard-toggle"
                role="button"
                tabindex="0"
                aria-expanded="${collapsed ? 'false' : 'true'}"
                aria-controls="${escapeHtml(bodyId)}"
                data-afmco-section-key="${safeSectionKey}"
            >
                <span class="collapse-indicator">${frappe.utils.icon(collapsed ? 'es-line-down' : 'es-line-up', 'sm', 'mb-1')}</span>
                <span class="font-weight-bold text-dark">${safeTitle}</span>
                ${safeMeta ? `<span class="text-muted small mx-2">${safeMeta}</span>` : ''}
            </div>
            <div id="${escapeHtml(bodyId)}" class="section-body${collapsed ? ' hide' : ''}${safeBodyClass}">
                ${bodyHtml}
            </div>
        </div>
    `;
}

function toggleAfmcoDashboardSection(header) {
    const $header = $(header);
    const collapsed = !$header.hasClass('collapsed');
    const $body = $header.next('.section-body');

    $header
        .toggleClass('collapsed', collapsed)
        .attr('aria-expanded', collapsed ? 'false' : 'true');
    $body.toggleClass('hide', collapsed);
    $header.find('.collapse-indicator').html(
        frappe.utils.icon(collapsed ? 'es-line-down' : 'es-line-up', 'sm', 'mb-1')
    );

    const sectionKey = $header.attr('data-afmco-section-key');
    if (sectionKey) {
        saveAfmcoSectionCollapsed(sectionKey, collapsed);
    }
}

function bindAfmcoDashboardEvents() {
    const $document = $(document);

    $document
        .off('click.afmcoDashboardToggle', '.afmco-dashboard-toggle')
        .on('click.afmcoDashboardToggle', '.afmco-dashboard-toggle', function() {
            toggleAfmcoDashboardSection(this);
        });

    $document
        .off('keydown.afmcoDashboardToggle', '.afmco-dashboard-toggle')
        .on('keydown.afmcoDashboardToggle', '.afmco-dashboard-toggle', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleAfmcoDashboardSection(this);
            }
        });

    $document
        .off('click.afmcoTransferRow', '.afmco-transfer-row')
        .on('click.afmcoTransferRow', '.afmco-transfer-row', function() {
            const documentName = $(this).attr('data-docname');
            if (documentName) {
                frappe.set_route('Form', 'Payment Requisition', documentName);
            }
        });
}

// Form events ------------------------------------------------------------------
frappe.ui.form.on('Payment Requisition', {

    on_hide(frm) {
        stopAccountsBotStatus(frm);
    },

    onload(frm) {
        if (frm.doc.workflow_state === 'Financial Controller' && frappe.user_roles.includes('Auditor')) {
            displayPaymentApproverPermissions(frm);
        }
    },

    refresh(frm) {
        bindAfmcoDashboardEvents();
        renderRemarkExcelDashboard(frm);
        addSystemManagerButtons(frm);

        frappe.require(['/assets/afmco/js/stepper.js', '/assets/afmco/css/stepper.css'], () => renderRequestCards(frm));
        validateAndDisplayBankAccountAlert(frm);
        handleFinancialControllerPermissions(frm);

        addPreviousRecordsButton(frm);
        addUrgentButton(frm);
        addAlreadyPaidButton(frm);
        renderNextAction(frm);
        addCreateJVButton(frm);
        addSupportingPackButton(frm);
        addAccountsBotButton(frm);
        showAmountInWords(frm, frm.doc.amount_in_words);
        showPaymentDates(frm);
        frappe.require(["/assets/afmco/js/attachment_check.js", "/assets/afmco/css/attachment_check.css"], () => afmco.attachment_check.render(frm));
        frappe.require("/assets/afmco/css/payment_requisition.css");
        renderSummary(frm);
    },

    after_workflow_action(frm) {
        frm.reload_doc();
    },

    remark(frm) {
        renderRemarkExcelDashboard(frm);
    },

    amount(frm) {
        showAmountInWords(frm, '');
    },

    validate(frm) {
        if (frm.doc.account_no) {
            const cleaned = frm.doc.account_no.replace(/[\s\-_]+/g, '').toUpperCase();
            if (cleaned !== frm.doc.account_no && validateBankAccount(cleaned)) {
                frm.set_value('account_no', cleaned);
            }
        }

        if (frm.doc.payment_type && frm.doc.payment_type.startsWith('-')) {
            frappe.msgprint({
                title: __('Error'),
                indicator: 'red',
                message: __('Please select a valid payment type from the dropdown list.')
            });
            frappe.validated = false;
        }
    },

    account_no(frm) {
        validateAndDisplayBankAccountAlert(frm);
    },

    payment_type(frm) {
        validateAndDisplayBankAccountAlert(frm);
        if (frm.doc.payment_type === 'Payroll (Salary)' && !frm.doc.multiple_beneficiaries) {
            frm.set_value('multiple_beneficiaries', 1);
        }
    },

    open_reference_document(frm) {
        let doctype = frm.doc.payment_type;
        if (doctype === 'Payroll (Salary)') {
            doctype = 'payroll-entry';
        }
        frappe.set_route('Form', doctype, frm.doc.tax_invoice_number);
    }
});

frappe.ui.form.on('Payment Requisition', Object.fromEntries([
    'amount', 'remark', 'account_no', 'payment_type', 'beneficiary_name', 'multiple_beneficiaries',
    'sadad_biller_code', 'sadad_bill_number', 'cost_center', 'project', 'payment_approver', 'if_it__urgent',
    'verify_payment', 'reason_of_urgency', 'bank_account', 'bank_payment_date', 'bank_reference_cf', 'jv_status',
    'tax_invoice_number'
].map((event) => [event, renderSummary])));

function renderSummary(frm) {
    frappe.require([
        '/assets/afmco/js/stepper.js',
        '/assets/afmco/css/stepper.css',
        '/assets/afmco/js/payment_requisition_summary.js',
        '/assets/afmco/css/payment_requisition_summary.css'
    ], () => afmco.pr_summary.render(frm));
}

function showAmountInWords(frm, words) {
    frm.set_df_property('amount', 'description', words ? frappe.utils.escape_html(words) : '');
}

function showPaymentDates(frm) {
    (frm.payment_date_indicators || []).forEach(($indicator) => $indicator.remove());
    const dates = (frm.doc.__onload || {}).payment_dates || [];
    frm.payment_date_indicators = dates.map(([journalEntry, date]) =>
        frm.dashboard.add_indicator(
            __('Journal Entry date {0}: {1}', [journalEntry, frappe.datetime.str_to_user(date)]),
            'blue'
        )
    );
}

// Journal Entry creation -------------------------------------------------------
function addCreateJVButton(frm) {
    const buttonLabel = __('Create JV');
    frm.remove_custom_button(buttonLabel);

    if (
        frm.doc.docstatus === 1 &&
        (!frm.doc.jv_status || frm.doc.jv_status === 'JV Not Created') &&
        JOURNAL_ENTRY_PAYMENT_TYPES.includes(frm.doc.payment_type)
    ) {
        frm.add_custom_button(buttonLabel, () => openCreateJVDialog(frm)).addClass('btn-primary');
    }
}

function addSupportingPackButton(frm) {
    const buttonLabel = __('Supporting Pack');
    frm.remove_custom_button(buttonLabel);

    if (frm.doc.jv_status === 'JV Created') {
        frm.add_custom_button(buttonLabel, () => chooseSupportingPackEntry(frm));
    }
}

const ACCOUNTS_BOT_STOPPED = 'Stopped - Needs Review';
const ACCOUNTS_BOT_CREATED = 'Journal Entry Created';
const ACCOUNTS_BOT_REQUEST_SENT = 'Request Sent';
const ACCOUNTS_BOT_RECEIPT_READ = 'Receipt Read';
const ACCOUNTS_BOT_IDLE = [ACCOUNTS_BOT_CREATED, ACCOUNTS_BOT_RECEIPT_READ, ACCOUNTS_BOT_STOPPED, undefined, null, ''];
const ACCOUNTS_BOT_PICKUP_MINUTES = 15;
const ACCOUNTS_BOT_QUESTION = /^\[accounts-bot-question q=([\w.-]+) field=([\w.-]+)\]$/;
const ACCOUNTS_BOT_STOP_QUESTION = /^\[accounts-bot-stop-question q=([A-Za-z0-9_.-]+)\]$/;
const ACCOUNTS_BOT_STOP_ANSWER_LIMIT = 500;
const accountsBotPressedAt = new Map();
const accountsBotAnswered = new Set();
const ACCOUNTS_BOT_ASKING = [ACCOUNTS_BOT_STOPPED, ACCOUNTS_BOT_CREATED];

function addAccountsBotButton(frm) {
    const sendLabel = __('Account Bot');
    const retryLabel = __('Retry Account Bot');
    frm.remove_custom_button(sendLabel);
    frm.remove_custom_button(retryLabel);
    const onload = frm.doc.__onload || {};
    const idle = ACCOUNTS_BOT_IDLE.includes(frm.doc.accounts_bot_status);

    if (onload.accounts_bot_allowed && idle) {
        frm.add_custom_button(sendLabel, () => callAccountsBot(frm, 'set_accounts_bot'));
    }
    if (onload.accounts_bot_viewer && frm.doc.accounts_bot_cf && frm.doc.accounts_bot_status === ACCOUNTS_BOT_STOPPED) {
        frm.add_custom_button(retryLabel, () => callAccountsBot(frm, 'retry_accounts_bot'));
    }
    renderAccountsBotIntro(frm);
    listenAccountsBotStatus(frm);
}

function callAccountsBot(frm, method, args = {}) {
    const name = frm.doc.name;
    frappe.call({
        method: `afmco.financial_operations.api.accounts_bot.${method}`,
        args: { name, ...args },
        freeze: true,
    })
        .then(() => frm.reload_doc())
        .then(() => {
            if (frm.doc.name === name) accountsBotPressedAt.set(name, frm.doc.accounts_bot_updated);
        });
}

function renderAccountsBotIntro(frm) {
    const status = frm.doc.accounts_bot_status;
    const onload = frm.doc.__onload || {};
    if (!status || !(onload.accounts_bot_viewer || onload.receipt_read_viewer)) {
        frm.set_intro();
        return;
    }
    let text = `${__('Accounts Bot')}: ${__(status)}`;
    let color = 'blue';
    if (status === ACCOUNTS_BOT_CREATED || status === ACCOUNTS_BOT_RECEIPT_READ) {
        color = 'green';
    } else if (status === ACCOUNTS_BOT_STOPPED) {
        color = 'orange';
    } else if (
        status === ACCOUNTS_BOT_REQUEST_SENT &&
        frm.doc.accounts_bot_updated &&
        moment().diff(frappe.datetime.str_to_obj(frm.doc.accounts_bot_updated), 'minutes') >= ACCOUNTS_BOT_PICKUP_MINUTES
    ) {
        color = 'yellow';
        text += ` — ${__('Accounts Bot has not picked up the request yet')}`;
    }
    const expected = ACCOUNTS_BOT_IDLE.includes(status) ? null : onload.accounts_bot_expected_finish;
    clearTimeout(frm.accountsBotOverdueTimer);
    if (expected) {
        const finish = frappe.datetime.str_to_obj(expected);
        const time = moment(finish).format('HH:mm');
        if (moment().isAfter(finish)) {
            color = 'yellow';
            text += ` — ${__('Past the expected finish time {0}', [time])}`;
        } else {
            text += ` — ${__('Expected finish {0}', [time])}`;
            const name = frm.doc.name;
            frm.accountsBotOverdueTimer = setTimeout(() => {
                if (frm.doc.name === name) renderAccountsBotIntro(frm);
            }, moment(finish).diff(moment()) + 1000);
        }
    }
    if (frm.doc.accounts_bot_note && color !== 'blue' && color !== 'yellow') {
        text += ` — ${frm.doc.accounts_bot_note}`;
    }
    const stopQuestion =
        status === ACCOUNTS_BOT_STOPPED && onload.accounts_bot_viewer && frm.doc.accounts_bot_cf
            ? pendingAccountsBotStopQuestion(frm.get_docinfo())
            : null;
    const choice = onload.accounts_bot_viewer ? onload.accounts_bot_choice : null;
    frm.set_intro(text, stopQuestion || choice ? 'green' : color);
    if (stopQuestion && frm.$intro_message) addAccountsBotStopAnswerBox(frm, stopQuestion);
    if (choice && frm.$intro_message) addAccountsBotChoice(frm, choice);
}

function addAccountsBotChoice(frm, choice) {
    const $box = $('<div class="mt-2"></div>').appendTo(frm.$intro_message);
    $('<p class="mb-2 font-weight-bold"></p>').text(choice.title).appendTo($box);
    afmco.accounts_bot_choice.render($box, choice);
}

function accountsBotLines(content) {
    return (content || '')
        .split(/\r?\n|<br\s*\/?>/i)
        .map(line => frappe.utils.html2text(line).trim())
        .filter(Boolean);
}

function pendingAccountsBotStopQuestion(docinfo) {
    const logs = ((docinfo && docinfo.info_logs) || [])
        .filter(log => log.comment_type === 'Info')
        .map(log => ({ creation: log.creation, lines: accountsBotLines(log.content) }));
    const latest = logs
        .filter(log => ACCOUNTS_BOT_STOP_QUESTION.test(log.lines[0] || ''))
        .sort((a, b) => (a.creation < b.creation ? 1 : -1))[0];
    if (!latest || !latest.lines[1]) return null;
    const id = ACCOUNTS_BOT_STOP_QUESTION.exec(latest.lines[0])[1];
    const answerTag = `[accounts-bot-stop-answer q=${id}]`;
    if (logs.some(log => (log.lines[0] || '').startsWith(answerTag))) return null;
    return { id, question: latest.lines[1] };
}

function addAccountsBotStopAnswerBox(frm, { id, question }) {
    const $box = $('<div class="mt-2"></div>').appendTo(frm.$intro_message);
    $('<p class="mb-2"></p>').text(question).appendTo($box);
    const $answer = $('<textarea class="form-control mb-2" rows="3"></textarea>')
        .attr('maxlength', ACCOUNTS_BOT_STOP_ANSWER_LIMIT)
        .appendTo($box);
    $('<button type="button" class="btn btn-primary btn-sm"></button>')
        .text(__('Send answer to Account Bot'))
        .on('click', () => {
            const answer = ($answer.val() || '').trim();
            if (answer) callAccountsBot(frm, 'answer_accounts_bot', { q: id, answer });
        })
        .appendTo($box);
}

function refreshAccountsBotStopQuestion(frm) {
    const name = frm.doc.name;
    frappe.call({
        method: 'frappe.desk.form.load.get_docinfo',
        args: { doctype: frm.doctype, name },
    }).then(() => {
        if (frm.doc.name === name) renderAccountsBotIntro(frm);
    });
}

function stopAccountsBotStatus(frm) {
    if (frm.accountsBotStatusHandler) {
        frappe.realtime.off('accounts_bot_status', frm.accountsBotStatusHandler);
    }
}

function listenAccountsBotStatus(frm) {
    stopAccountsBotStatus(frm);
    frm.accountsBotStatusHandler = data => {
        if (!data || data.name !== frm.doc.name) return;
        frm.doc.accounts_bot_status = data.status;
        frm.doc.accounts_bot_note = data.note;
        frm.doc.accounts_bot_updated = data.updated;
        addAccountsBotButton(frm);
        if (data.status === ACCOUNTS_BOT_STOPPED) refreshAccountsBotStopQuestion(frm);
        if (ACCOUNTS_BOT_ASKING.includes(data.status)) askAccountsBotQuestion(frm);
    };
    frappe.realtime.on('accounts_bot_status', frm.accountsBotStatusHandler);
}

function askAccountsBotQuestion(frm) {
    const name = frm.doc.name;
    const pressedAt = accountsBotPressedAt.get(name);
    const onload = frm.doc.__onload || {};
    if (!pressedAt || !onload.accounts_bot_viewer || !frm.doc.accounts_bot_cf) return;
    frappe.call({
        method: 'frappe.desk.form.load.get_docinfo',
        args: { doctype: frm.doctype, name },
    }).then(r => {
        if (!r.docinfo || frm.doc.name !== name || !ACCOUNTS_BOT_ASKING.includes(frm.doc.accounts_bot_status)) return;
        const question = latestAccountsBotQuestion(r.docinfo, pressedAt);
        if (question) showAccountsBotQuestion(frm, question);
    });
}

function latestAccountsBotQuestion(docinfo, pressedAt) {
    const latest = (docinfo.info_logs || [])
        .filter(log => log.comment_type === 'Info' && log.creation >= pressedAt)
        .map(log => ({ creation: log.creation, lines: accountsBotLines(log.content) }))
        .filter(log => ACCOUNTS_BOT_QUESTION.test(log.lines[0] || ''))
        .sort((a, b) => (a.creation < b.creation ? 1 : -1))[0];
    if (!latest) return null;
    const id = ACCOUNTS_BOT_QUESTION.exec(latest.lines[0])[1];
    const answerTag = `[accounts-bot-answer q=${id}]`;
    const answered =
        accountsBotAnswered.has(id) ||
        (docinfo.comments || []).some(comment => frappe.utils.html2text(comment.content || '').includes(answerTag));
    const options = latest.lines.slice(2);
    if (answered || !latest.lines[1] || options.length < 2 || options.length > 10) return null;
    return { id, question: latest.lines[1], options };
}

function showAccountsBotQuestion(frm, { id, question, options }) {
    const drafted = frm.doc.accounts_bot_status === ACCOUNTS_BOT_CREATED;
    const intro = drafted
        ? `<p class="text-muted">${__('The Journal Entry draft uses the first option. Choose another option and the Accounts Bot redrafts it.')}</p>`
        : '';
    const dialog = new frappe.ui.Dialog({
        title: __('Accounts Bot Question'),
        fields: [
            { fieldname: 'question', fieldtype: 'HTML', options: `<p>${frappe.utils.escape_html(question)}</p>${intro}` },
            ...options.map((option, index) => ({
                fieldname: `option_${index}`,
                fieldtype: 'Button',
                label: frappe.utils.escape_html(option),
                click: () => {
                    const method = !drafted ? 'retry_accounts_bot' : index ? 'set_accounts_bot' : null;
                    answerAccountsBotQuestion(frm, dialog, id, option, method);
                },
            })),
        ],
    });
    dialog.show();
}

function answerAccountsBotQuestion(frm, dialog, id, option, method) {
    dialog.hide();
    frappe.xcall('frappe.desk.form.utils.add_comment', {
        reference_doctype: frm.doctype,
        reference_name: frm.doc.name,
        content: `[accounts-bot-answer q=${id}] ${frappe.utils.escape_html(option)}`,
        comment_email: frappe.session.user,
        comment_by: frappe.session.user_fullname,
    }).then(() => {
        accountsBotAnswered.add(id);
        if (method) callAccountsBot(frm, method);
    });
}

function chooseSupportingPackEntry(frm) {
    frappe.db.get_list('Journal Entry', {
        filters: { expense_request_cf: frm.doc.name, docstatus: ['<', 2] },
        fields: ['name'],
        order_by: 'creation desc',
    }).then(entries => {
        if (!entries.length) {
            frappe.msgprint(__('No Journal Entry is linked to this Payment Requisition.'));
        } else if (entries.length === 1) {
            attachSupportingPack(frm, entries[0].name);
        } else {
            frappe.prompt(
                {
                    label: __('Journal Entry'),
                    fieldname: 'journal_entry',
                    fieldtype: 'Select',
                    options: entries.map(entry => entry.name),
                    default: entries[0].name,
                    reqd: 1,
                },
                values => attachSupportingPack(frm, values.journal_entry),
                __('Supporting Pack')
            );
        }
    });
}

function attachSupportingPack(frm, journalEntry) {
    frappe.call({
        method: 'afmco.financial_operations.api.requisition_pack.attach_pack',
        args: { requisition: frm.doc.name, journal_entry: journalEntry },
        freeze: true,
        freeze_message: __('Preparing the supporting pack...'),
    }).then(({ message }) => {
        if (message.queued) {
            frappe.msgprint(__('The supporting pack is being prepared and will be attached to {0}.', [journalEntry]));
            return;
        }
        let text = __('The supporting pack is attached to {0}.', [journalEntry]);
        if (message.attached.length) {
            text += '<br>' + __('Attached separately: {0}', [message.attached.map(frappe.utils.escape_html).join(', ')]);
        }
        if (message.not_locked.length) {
            text += '<br>' + __('Attached without a lock: {0}', [message.not_locked.map(frappe.utils.escape_html).join(', ')]);
        }
        if (message.skipped.length) {
            text += '<br>' + __('Not included: {0}', [message.skipped.map(frappe.utils.escape_html).join(', ')]);
        }
        frappe.msgprint(text);
    });
}

function openCreateJVDialog(frm) {
    const dialog = new frappe.ui.Dialog({
        title: __('Journal Entry Details'),
        fields: [
            {
                label: __('Credit Bank Account'),
                fieldname: 'bank_account',
                fieldtype: 'Link',
                options: 'Account',
                reqd: 1,
                get_query: () => ({ filters: { is_group: 0, account_type: 'Bank' } })
            },
            {
                label: __('Employee Classification'),
                fieldname: 'employee_type',
                fieldtype: 'Select',
                options: ['Project Employee (Projects)', 'Administration Employee (Administration)'],
                default: 'Project Employee (Projects)',
                reqd: 1,
                hidden: !JOURNAL_ENTRY_PAYMENT_TYPES.includes(frm.doc.payment_type)
            }
        ],
        primary_action_label: __('Create JV'),
        primary_action(values) {
            dialog.hide();
            createJournalEntryDraft(frm, values);
        }
    });

    return frappe.db.get_value('Account', { account_number: '122001' }, 'name')
        .then(res => {
            const accountName = res?.message?.name || res?.name;
            if (accountName) {
                dialog.set_value('bank_account', accountName);
            }
        })
        .catch(error => {
            console.warn('Unable to load the default bank account:', error);
        })
        .then(() => {
            dialog.show();
            return dialog;
        })
        .catch(error => {
            console.error('Unable to open the Journal Entry dialog:', error);
            frappe.msgprint({
                title: __('Journal Entry Dialog Failed'),
                indicator: 'red',
                message: __('The Journal Entry dialog could not be opened. Please try again.')
            });
            return null;
        });
}

function createJournalEntryDraft(frm, values) {
    return frappe.call({
        method: 'afmco.financial_operations.api.journal_entry.make_requisition_entry',
        args: {
            name: frm.doc.name,
            bank_account: values.bank_account,
            administration: values.employee_type === 'Administration Employee (Administration)' ? 1 : 0
        },
        freeze: true,
        freeze_message: __('Preparing Journal Entry...')
    }).then((r) => {
        frappe.model.sync(r.message);
        frappe.set_route('Form', r.message.doctype, r.message.name);
    });
}

// Alerts and bank-account validation ------------------------------------------
function validateAndDisplayBankAccountAlert(frm) {
    const fieldWrapper = frm.get_field('account_no')?.$wrapper;

    if (frm.doc.payment_type === 'SADAD Payment') {
        frm.set_df_property('account_no', 'description', '');
        if (fieldWrapper) {
            fieldWrapper.removeClass('has-error has-success');
            fieldWrapper.find('.form-control').css('border-color', '');
        }
        return;
    }

    const raw_account_no = frm.doc.account_no || '';
    const cleaned_account_no = raw_account_no.replace(/[\s\-_]+/g, '').toUpperCase();

    if (!raw_account_no.trim()) {
        frm.set_df_property('account_no', 'hidden', 0);
        frm.set_df_property('account_no', 'description', `
            <div class="text-muted small mt-1">
                <i class="fa fa-info-circle mx-1 text-warning"></i> ${__('Account number field is empty.')}
            </div>
        `);
        if (fieldWrapper) {
            fieldWrapper.removeClass('has-error has-success');
            fieldWrapper.find('.form-control').css('border-color', '');
        }
        return;
    }

    const is_cleaned_valid = validateBankAccount(cleaned_account_no);
    const has_formatting_issue = raw_account_no !== cleaned_account_no;

    if (is_cleaned_valid && has_formatting_issue) {
        frm.set_df_property('account_no', 'hidden', 0);
        frm.set_df_property('account_no', 'description', `
            <div class="d-flex align-items-center justify-content-between mt-1 p-2 bg-light border border-warning rounded">
                <span class="text-warning small font-weight-bold">
                    <i class="fa fa-exclamation-triangle mx-1"></i> ${__('IBAN contains spaces or formatting issues.')}
                </span>
                <button class="btn btn-xs btn-warning fix-iban-btn font-weight-bold" type="button">
                    <i class="fa fa-magic mx-1"></i> ${__('Fix & Remove Spaces')}
                </button>
            </div>
        `);

        if (fieldWrapper) {
            fieldWrapper.addClass('has-error').removeClass('has-success');
            fieldWrapper.find('.form-control').css('border-color', '#ffc107');

            setTimeout(() => {
                fieldWrapper.find('.fix-iban-btn').off('click').on('click', function(e) {
                    e.preventDefault();
                    frm.set_value('account_no', cleaned_account_no);
                    frappe.show_alert({
                        message: __('IBAN spaces removed and formatted successfully!'),
                        indicator: 'green'
                    });
                });
            }, 100);
        }
    } else if (is_cleaned_valid && !has_formatting_issue) {
        frm.set_df_property('account_no', 'description', `
            <div class="text-success small mt-1 font-weight-bold">
                <i class="fa fa-check-circle mx-1"></i> ${__('Valid Saudi IBAN (SA)')}
            </div>
        `);
        if (fieldWrapper) {
            fieldWrapper.addClass('has-success').removeClass('has-error');
            fieldWrapper.find('.form-control').css('border-color', '#28a745');
        }
    } else {
        frm.set_df_property('account_no', 'hidden', 0);
        frm.set_df_property('account_no', 'description', `
            <div class="text-danger small mt-1 font-weight-bold">
                <i class="fa fa-exclamation-triangle mx-1"></i> ${__('Please verify the accuracy of the IBAN to avoid errors during banking transactions.')}
            </div>
        `);
        if (fieldWrapper) {
            fieldWrapper.addClass('has-error').removeClass('has-success');
            fieldWrapper.find('.form-control').css('border-color', '#dc3545');
        }
    }
}

function validateBankAccount(account_number) {
    if (!account_number || typeof account_number !== 'string') return false;
    const normalizedAccount = account_number.replace(/[\s\-_]+/g, '').toUpperCase();
    if (!/^SA\d{22}$/.test(normalizedAccount)) return false;

    const rearranged = normalizedAccount.slice(4) + normalizedAccount.slice(0, 4);
    const numericIban = rearranged.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55));
    let remainder = 0;

    for (const digit of numericIban) {
        remainder = (remainder * 10 + Number(digit)) % 97;
    }

    return remainder === 1;
}

function getAccountValidationResult(account_no) {
    if (!account_no) {
        return {
            hasError: true,
            title: __('Invalid IBAN'),
            message: __('Account number field is empty.'),
            type: 'warning'
        };
    }

    if (!validateBankAccount(account_no)) {
        return {
            hasError: true,
            title: __('Invalid IBAN'),
            message: __('Please verify the accuracy of the IBAN to avoid errors during banking transactions.'),
            type: 'warning'
        };
    }

    return { hasError: false };
}

function handleFinancialControllerPermissions(frm) {
    $('.payment-approver-message').remove();

    if (frm.doc.workflow_state === 'Financial Controller' && frappe.user_roles.includes('Auditor')) {
        displayPaymentApproverPermissions(frm);
    }
}

function displayPaymentApproverPermissions(frm) {
    if (!frm.doc.role) return;

    const formatted_role = escapeHtmlWithLineBreaks(frm.doc.role);
    const alertHtml = build_afmco_alert(
        'info',
        __('Please note that this document is pending approval from the {0}. Ensure all required verifications are completed before proceeding.', [formatted_role]),
        'fa-shield-alt',
        true
    );
    const message = `<div class="payment-approver-message">${alertHtml}</div>`;

    $('.payment-approver-message').remove();

    if (frm.page && frm.page.body) {
        $(frm.page.body).prepend(message);
    }
}

// Account audit dashboard ------------------------------------------------------
function addPreviousRecordsButton(frm) {
    const buttonLabel = __('Check Account Transactions');
    const allowedRoles = ['Auditor', 'General Manager', 'Projects Manager'];
    const hasPermission = frappe.user_roles.some(role => allowedRoles.includes(role));

    frm.remove_custom_button(buttonLabel);
    frm.remove_custom_button(buttonLabel, __('Reports'));

    if (hasPermission && frm.doc.account_no && validateBankAccount(frm.doc.account_no)) {
        const btn = frm.add_custom_button(
            buttonLabel,
            () => loadAndRenderAccountAuditDashboard(frm)
        );
        if (btn) btn.removeClass('btn-default btn-secondary').addClass('btn-primary');
    }
}

async function fetchAllAccountTransfers(frm, pageSize = 500) {
    const accountNumber = frm.doc.account_no;
    const documentName = frm.doc.name;
    const records = [];
    const seenNames = new Set();
    let start = 0;

    while (true) {
        const batch = await fetchListRecords('Payment Requisition', {
            filters: [
                ['account_no', '=', accountNumber],
                ['workflow_state', '!=', 'Rejected'],
                ['name', '!=', documentName]
            ],
            fields: ['name', 'creation', 'amount'],
            order_by: 'creation desc, name desc',
            limit: pageSize,
            start
        });

        if (!Array.isArray(batch)) {
            throw new Error(__('The account audit returned an invalid response.'));
        }

        let addedRecords = 0;
        batch.forEach(record => {
            if (!seenNames.has(record.name)) {
                seenNames.add(record.name);
                records.push(record);
                addedRecords += 1;
            }
        });

        if (batch.length < pageSize) break;
        if (addedRecords === 0) {
            throw new Error(__('Account audit pagination did not advance.'));
        }
        start += batch.length;
    }

    return records;
}

function handleAccountAuditError(error) {
    console.error('Account audit failed:', error);
    frappe.msgprint({
        title: __('Account Audit Failed'),
        indicator: 'red',
        message: __('The account audit could not be loaded. Please verify your permission and connection, then try again.')
    });
}

function loadAndRenderAccountAuditDashboard(frm) {
    if (frm.__afmco_account_audit_request) {
        frappe.show_alert({ message: __('Account audit is already loading...'), indicator: 'blue' });
        return frm.__afmco_account_audit_request.promise;
    }

    const requestKey = `${frm.doc.name || ''}:${frm.doc.account_no || ''}:${frm.doc.payment_type || ''}`;
    const request = { key: requestKey, promise: null };
    const isCurrentDocument = () => {
        const activeForm = typeof cur_frm === 'undefined' ? null : cur_frm;
        if (activeForm && activeForm !== frm) return false;

        return requestKey === `${frm.doc.name || ''}:${frm.doc.account_no || ''}:${frm.doc.payment_type || ''}`;
    };

    frappe.show_alert({ message: __('Loading account audit data...'), indicator: 'blue' });
    removeAfmcoDashboardSections(frm, '.account-audit-section');

    request.promise = fetchAllAccountTransfers(frm)
        .then(transfers => {
            if (!isCurrentDocument()) return null;

            return fetchListRecords('Employee', {
                filters: { bank_ac_no: frm.doc.account_no },
                fields: [
                    'employee', 'employee_number', 'employee_name', 'status', 'designation',
                    'department', 'branch', 'date_of_joining', 'iqama_expiration_date',
                    'bank_name', 'bank_ac_no', 'personal_email', 'cell_number'
                ],
                limit: 1
            }).then(employees => ({ transfers, employees }));
        })
        .then(result => {
            if (!result || !isCurrentDocument()) return null;

            const { transfers, employees } = result;

            const employee = employees && employees.length ? employees[0] : null;

            if (employee && frm.doc.payment_type === 'Petty Cash') {
                return fetchListRecords('GL Entry', {
                    filters: [['party', '=', employee.employee]],
                    fields: [{ SUM: 'debit', as: 'total_debit' }, { SUM: 'credit', as: 'total_credit' }],
                    group_by: 'party',
                    limit: 1
                }).then(gl => {
                    const balance = gl && gl.length
                        ? Number(gl[0].total_debit || 0) - Number(gl[0].total_credit || 0)
                        : 0;
                    if (isCurrentDocument()) {
                        renderAccountAuditCard(frm, transfers, employee, balance);
                    }
                });
            }

            renderAccountAuditCard(frm, transfers, employee, null);
            return null;
        })
        .catch(error => {
            if (isCurrentDocument()) {
                handleAccountAuditError(error);
            }
            return null;
        })
        .finally(() => {
            if (frm.__afmco_account_audit_request === request) {
                delete frm.__afmco_account_audit_request;
            }
        });

    frm.__afmco_account_audit_request = request;
    return request.promise;
}

function renderAccountAuditCard(frm, transfers, employee, pettyCashBalance) {
    const { tableRows, yearlySummary, grandTotal } = processTransferRecords(transfers || []);
    const displayedRows = tableRows.slice(0, 50);
    const transfersTable = createTransfersTable(displayedRows);
    const summaryTable = createSummaryTable(yearlySummary, grandTotal, frm.doc.amount || 0);
    const transferLimitNotice = tableRows.length > displayedRows.length
        ? `<div class="text-muted small mb-2">${escapeHtml(__('Showing the latest {0} of {1} transfers. Totals include all records.', [displayedRows.length, tableRows.length]))}</div>`
        : '';

    const employeeContent = employee
        ? createEmployeeTable(employee)
        : build_afmco_alert('warning', __('No employee account record linked to this IBAN.'), 'fa-exclamation-triangle');

    let pettyCashHtml = '';
    if (pettyCashBalance !== null) {
        const maxLimit = 20000;
        const percentage = Math.max(0, Math.min((pettyCashBalance / maxLimit) * 100, 100));
        pettyCashHtml = `
            <div class="mt-4 pt-3 border-top">
                <div class="text-muted font-weight-bold mb-2"><i class="fa fa-wallet mx-1"></i> ${__('Advance Balance Information')}</div>
                ${createProgressBar(percentage)}
                ${createBalanceTable(pettyCashBalance, maxLimit)}
            </div>
        `;
    }

    const auditCardHtml = buildAfmcoCollapsibleSection({
        sectionKey: 'account-audit-section',
        wrapperClass: 'account-audit-section custom mb-4',
        title: __('Account & Transaction Audit'),
        meta: `(${transfers.length} ${__('Previous Transactions')})`,
        collapsedByDefault: false,
        bodyHtml: `
            <div class="row">
                <div class="col-md-7">
                    <div class="text-muted font-weight-bold mb-2">${__('Previous Transfers')}</div>
                    ${transferLimitNotice}
                    ${transfersTable}
                    <div class="text-muted font-weight-bold mt-4 mb-2">${__('Yearly Summary')}</div>
                    ${summaryTable}
                </div>
                <div class="col-md-5">
                    <div class="text-muted font-weight-bold mb-2">${__('Employee Details')}</div>
                    ${employeeContent}
                    ${pettyCashHtml}
                </div>
            </div>
        `
    });

    appendAfmcoDashboardSection(frm, auditCardHtml);
}

function processTransferRecords(records) {
    const yearly_totals = {};
    let grand_total = 0;

    const tableRows = records.map(d => {
        const parsedYear = d.creation ? new Date(d.creation).getFullYear() : null;
        const fallbackYear = String(d.name || '').match(/\d{4}/)?.[0];
        const year = Number.isFinite(parsedYear) ? parsedYear : fallbackYear;
        const parsedAmount = Number(d.amount || 0);
        const amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;

        if (year) {
            yearly_totals[year] = (yearly_totals[year] || 0) + amount;
        }
        grand_total += amount;

        return { name: d.name, date: frappe.datetime.str_to_user(d.creation, false, true), amount: amount };
    });

    return { tableRows, yearlySummary: yearly_totals, grandTotal: grand_total };
}

function createTransfersTable(rows) {
    if (!rows || !rows.length) {
        return build_afmco_alert('warning', __('No previous transfers found for this account.'), 'fa-info-circle');
    }

    const tableRows = rows.map(d => `
        <tr class="afmco-transfer-row" data-docname="${escapeHtml(d.name)}" style="cursor: pointer;">
            <td><i class="fa fa-file-alt text-muted ${isRTL ? 'ms-1' : 'me-1'}"></i> ${escapeHtml(d.name)}</td>
            <td>${escapeHtml(d.date || '-')}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(d.amount))}</td>
        </tr>
    `).join('');

    const headers = `
        <th>${__('Document')}</th>
        <th>${__('Date')}</th>
        <th class="text-right">${__('Amount')}</th>
    `;

    return build_afmco_table(headers, tableRows);
}

function createSummaryTable(yearlySummary, grandTotal, currentAmount) {
    const years = Object.keys(yearlySummary || {}).sort((a, b) => b - a);
    const previousTransactionsTotal = Number(grandTotal || 0);
    const currentRequestAmount = Number(currentAmount || 0);
    const totalIncludingCurrentRequest = previousTransactionsTotal + currentRequestAmount;

    const summaryRows = years.length > 0 ? years.map(year => `
        <tr>
            <td><i class="fa fa-calendar text-muted ${isRTL ? 'ms-1' : 'me-1'}"></i> ${escapeHtml(year)}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(yearlySummary[year]))}</td>
        </tr>
    `).join('') : `
        <tr>
            <td colspan="2" class="text-center text-muted">${__('No previous transaction totals')}</td>
        </tr>
    `;

    const headers = `<th>${__('Year')}</th><th class="text-right">${__('Total')}</th>`;
    const tfoot = `
        <tr>
            <td class="font-weight-bold">${__('Previous Transactions Total')}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(previousTransactionsTotal))}</td>
        </tr>
        <tr>
            <td class="font-weight-bold">${__('Current Request')}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(currentRequestAmount))}</td>
        </tr>
        <tr class="table-active">
            <td class="font-weight-bold"><i class="fa fa-calculator text-muted ${isRTL ? 'ms-1' : 'me-1'}"></i> ${__('Total Including Current Request')}</td>
            <td class="text-right font-weight-bold text-primary">${escapeHtml(format_currency(totalIncludingCurrentRequest))}</td>
        </tr>
    `;

    return build_afmco_table(headers, summaryRows, tfoot);
}

function createEmployeeTable(employee) {
    const fields = [
        { key: 'employee_name', label: 'Employee Name', icon: 'fa-id-card', color: 'primary' },
        { key: 'employee_number', label: 'Employee Number', icon: 'fa-hashtag', color: 'info' },
        { key: 'status', label: 'Status', icon: 'fa-toggle-on', color: 'success' },
        { key: 'department', label: 'Department', icon: 'fa-building', color: 'warning' },
        { key: 'iqama_expiration_date', label: 'Iqama Expiration Date', icon: 'fa-calendar-alt', color: 'danger' },
        { key: 'personal_email', label: 'Personal Email', icon: 'fa-envelope', color: 'primary' },
        { key: 'cell_number', label: 'Cell Number', icon: 'fa-mobile-alt', color: 'info' }
    ];

    const rows = fields.map(field => createTableRow(field, employee[field.key] || '-')).join('');
    return build_afmco_table('', rows);
}

function createTableRow(field, value) {
    const isExpired = field.key === 'iqama_expiration_date' && value !== '-' && new Date(value) < new Date();
    const isInactive = field.key === 'status' && ['Inactive', 'Hold'].includes(value);
    const dangerClass = (isExpired || isInactive) ? 'text-danger font-weight-bold' : '';

    return `
        <tr>
            <td class="font-weight-bold" style="width: 45%;">
                <i class="fa ${field.icon} text-${field.color} mx-1"></i>
                ${escapeHtml(__(field.label))}
            </td>
            <td class="${dangerClass}">
                ${escapeHtml(value)}
                ${isExpired ? '<i class="fa fa-exclamation-circle text-danger mx-1"></i>' : ''}
                ${isInactive ? '<i class="fa fa-times-circle text-danger mx-1"></i>' : ''}
            </td>
        </tr>
    `;
}

function createProgressBar(percentage) {
    const colorClass = percentage < 50 ? 'bg-success' : (percentage < 80 ? 'bg-warning' : 'bg-danger');

    return `
        <div class="mb-3">
            <div class="progress" style="height: 20px;">
                <div class="progress-bar ${colorClass}" role="progressbar"
                     style="width: ${percentage}%;"
                     aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100">
                    ${percentage.toFixed(0)}%
                </div>
            </div>
            <div class="text-center text-muted small mt-1">
                ${__('Petty Cash Balance')}: ${percentage.toFixed(2)}%
            </div>
        </div>
    `;
}

function createBalanceTable(final_balance, max_limit) {
    const headers = `
        <th>${__('Description')}</th>
        <th class="text-${isRTL ? 'left' : 'right'}">${__('Amount')}</th>
    `;
    const rows = `
        <tr>
            <td><i class="fa fa-balance-scale text-primary mx-1"></i> ${__('Final Balance')}</td>
            <td class="text-${isRTL ? 'left' : 'right'} font-weight-bold">${escapeHtml(format_currency(final_balance))}</td>
        </tr>
        <tr>
            <td><i class="fa fa-chart-line text-warning mx-1"></i> ${__('Maximum Allowed Limit')}</td>
            <td class="text-${isRTL ? 'left' : 'right'} font-weight-bold text-warning">${escapeHtml(format_currency(max_limit))}</td>
        </tr>
    `;
    return build_afmco_table(headers, rows);
}

function renderRequestCards(frm) {
    frm.dashboard.parent.find('.afmco-pr-card').remove();
    const cards = [];
    if (frm.doc.if_it__urgent) {
        const reason = frm.doc.reason_of_urgency || __('No reason provided');
        cards.push([
            `<p class="text-danger">${escapeHtmlWithLineBreaks(__('This request is already marked as urgent with reason: {0}', [reason]))}</p>`,
            __('Urgent')
        ]);
    }
    if (frm.doc.verify_payment) {
        cards.push([
            `<p>${escapeHtml(__('This transaction has been documented as settled. Please ensure all necessary approvals and authorizations are verified before proceeding.'))}</p>`,
            __('Already paid')
        ]);
    }
    const stepper = workflowStepper(frm);
    if (stepper) cards.push([stepper, __('Workflow')]);

    cards.forEach(([html, label]) => {
        const body = frm.dashboard.add_section(html, label);
        body.closest('.form-dashboard-section').addClass('afmco-pr-card');
        afmco.stepper.center(body);
    });
    if (cards.length) frm.dashboard.show();
}

function workflowStepper(frm) {
    const path = afmco.stepper.workflow(frm);
    if (!path) return '';
    return afmco.stepper.html({ ...path, color: path.halted ? 'red' : 'blue' });
}

function addAlreadyPaidButton(frm) {
    const buttonLabel = __('Already paid');
    frm.remove_custom_button(buttonLabel);

    if (frm.is_new() && !frm.doc.verify_payment) {
        frm.add_custom_button(buttonLabel, () => frm.set_value('verify_payment', 1).then(() => frm.refresh()));
    }
}

function renderNextAction(frm) {
    const $sidebar = $(frm.wrapper).find('.form-sidebar').first();
    $sidebar.find('.afmco-next-action').remove();
    if (frm.is_new() || !frm.doc.workflow_state) return;

    if (frm.doc.workflow_state === 'Pending') {
        renderNextActionCard($sidebar, [{ role: '', users: [{ user: frm.doc.owner, full_name: frappe.user.full_name(frm.doc.owner) }] }]);
        return;
    }

    const docname = frm.doc.name;
    frappe.call({
        method: 'afmco.financial_operations.api.next_action.get_next_action_users',
        args: { doctype: frm.doctype, name: docname }
    }).then((r) => {
        if (frm.doc.name === docname) renderNextActionCard($sidebar, r.message);
    });
}

function renderNextActionCard($sidebar, rows) {
    $sidebar.find('.afmco-next-action').remove();
    if (!Array.isArray(rows) || !rows.length) return;

    const groups = new Map();
    rows.forEach((row) => {
        if (!groups.has(row.role)) groups.set(row.role, new Map());
        (row.users || []).forEach((user) => groups.get(row.role).set(user.user, user));
    });

    const body = [...groups].map(([role, users]) => {
        const head = role ? `<div class="afmco-next-action-role">${escapeHtml(__(role))}</div>` : '';
        const inner = users.size
            ? `<div class="afmco-next-action-chips">${[...users.values()].map(nextActionChip).join('')}</div>`
            : `<div class="afmco-next-action-note">${escapeHtml(__('No users'))}</div>`;
        return `<div class="afmco-next-action-group">${head}${inner}</div>`;
    }).join('');

    $sidebar.append(
        `<div class="sidebar-section afmco-next-action"><div class="sidebar-label">${escapeHtml(__('Next Action'))}</div>${body}</div>`
    );
}

function nextActionChip({ user, full_name }) {
    const name = String(full_name || user || '').replace(/[\s.]+$/, '').trim() || user;
    return `<span class="afmco-next-action-chip" title="${escapeHtml(name)}">${frappe.avatar(user, 'avatar-xs')}<span class="afmco-next-action-name">${escapeHtml(name)}</span></span>`;
}

function addUrgentButton(frm) {
    const buttonLabel = __('Mark as Urgent');
    frm.remove_custom_button(buttonLabel);
    frm.remove_custom_button(buttonLabel, __('Actions'));

    if (frm.doc.if_it__urgent === 1) return;

    const btn = frm.add_custom_button(
        buttonLabel,
        () => handleMarkAsUrgent(frm)
    );

    if (btn) {
        btn.removeClass('btn-default btn-secondary').addClass('btn-danger');
    }
}

function handleMarkAsUrgent(frm) {
    if (!frm.perm[0].write) {
        frappe.show_alert({
            message: __('You do not have the necessary permission to modify this document.'),
            indicator: 'red'
        }, 5);
        return;
    }

    const dialog = new frappe.ui.Dialog({
        title: __('Enter Reason for Urgency'),
        fields: [{
            fieldname: 'reason_of_urgency',
            fieldtype: 'Small Text',
            label: __('Marking this request as urgent will notify all concerned parties for immediate action. Please provide a clear justification for the urgency.'),
            reqd: true,
            rows: 4
        }],
        primary_action_label: __('Submit'),
        primary_action(values) {
            if (values.reason_of_urgency) {
                return Promise.resolve()
                    .then(() => frm.set_value('reason_of_urgency', values.reason_of_urgency))
                    .then(() => frm.set_value('if_it__urgent', 1))
                    .then(() => frm.save())
                    .then(() => {
                        frappe.show_alert({
                            message: __('The request has been marked as urgent. An email notification has been sent to all concerned parties.'),
                            indicator: 'green'
                        }, 5);
                        dialog.hide();
                    })
                    .catch(error => {
                        console.error('Unable to mark the request as urgent:', error);
                        frappe.msgprint({
                            title: __('Error'),
                            message: __('Failed to update the request. Please try again.'),
                            indicator: 'red'
                        });
                        return null;
                    });
            }

            return Promise.resolve(null);
        }
    });

    dialog.show();
}

// System Manager tools and imported-data dashboard ----------------------------
function addSystemManagerButtons(frm) {
    const buttonLabel = __('Show Changes');
    frm.remove_custom_button(buttonLabel);
    frm.remove_custom_button(buttonLabel, __('Actions'));

    if (frappe.user.has_role('System Manager')) {
        frm.add_custom_button(buttonLabel, () => show_document_changes_dashboard(frm));
    }
}

function show_document_changes_dashboard(frm) {
    return fetchListRecords('Version', {
        filters: {
            docname: frm.docname,
            ref_doctype: 'Payment Requisition'
        },
        fields: ['creation', 'modified_by', 'data'],
        order_by: 'creation desc',
        limit: 20
    }).then(records => {
        if (!records || !records.length) {
            frappe.msgprint(__('No changes history found for this document.'));
            return;
        }

        const changesTable = createChangesTable(records);
        const dialog = new frappe.ui.Dialog({
            title: __('Document Changes History'),
            size: 'large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'changes_html',
                    options: `<div class="p-2">${changesTable}</div>`
                }
            ]
        });
        dialog.show();
    }).catch(error => {
        console.error('Unable to load document change history:', error);
        frappe.msgprint({
            title: __('Changes History Failed'),
            indicator: 'red',
            message: __('The document changes history could not be loaded. Please try again.')
        });
    });
}

function createChangesTable(versionData) {
    let rowIndex = 1;
    const allRows = [];

    versionData.forEach((version) => {
        let changeDetails;
        try {
            changeDetails = JSON.parse(version.data);
        } catch (error) {
            console.warn('Skipping malformed Version data:', error);
            return;
        }
        const userInfo = frappe.user_info(version.modified_by) || {};
        const fullname = userInfo.fullname || version.modified_by || '-';
        const formattedDate = frappe.datetime.str_to_user(version.creation);

        if (changeDetails && Array.isArray(changeDetails.changed) && changeDetails.changed.length > 0) {
            changeDetails.changed.forEach(change => {
                if (!Array.isArray(change) || change.length < 3) return;

                const [fieldName, oldValue, newValue] = change;
                const formattedFieldName = String(fieldName || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                allRows.push(`
                    <tr>
                        <td class="text-center text-muted">${rowIndex++}</td>
                        <td class="font-weight-bold">${escapeHtml(formattedFieldName)}</td>
                        <td class="text-danger"><del>${escapeHtml(oldValue ?? '-')}</del></td>
                        <td class="text-success font-weight-bold">${escapeHtml(newValue ?? '-')}</td>
                        <td>${escapeHtml(fullname)}</td>
                        <td class="text-muted small">${escapeHtml(formattedDate)}</td>
                    </tr>
                `);
            });
        }
    });

    const tableContent = allRows.length > 0 ? allRows.join('') : '<tr><td colspan="6" class="text-center text-muted p-4">No changes found</td></tr>';
    const headers = `
        <th class="text-center" width="5%">#</th>
        <th width="22%">Field</th>
        <th width="22%">Old Value</th>
        <th width="22%">New Value</th>
        <th width="15%">Modified By</th>
        <th width="14%">Date</th>
    `;

    return build_afmco_table(headers, tableContent);
}

// Remark parsing and dashboards -----------------------------------------------
function splitTabularCells(line, isPipeTable) {
    const delimiter = isPipeTable ? '|' : '\t';
    const cells = String(line).split(delimiter);

    if (isPipeTable && cells.length > 0 && cells[0].trim() === '') {
        cells.shift();
    }
    if (isPipeTable && cells.length > 0 && cells[cells.length - 1].trim() === '') {
        cells.pop();
    }

    return cells.map(cell => cell.trim());
}

function parseTabularRemarkText(text) {
    if (!text || typeof text !== 'string') return null;

    const lines = text.split(/\r?\n/)
        .map(raw => ({ raw, trimmed: raw.trim() }))
        .filter(line => line.trimmed.length > 0 && !/^[\-\=\_\*\s]{3,}$/.test(line.trimmed));

    if (lines.length < 2) return null;

    let title = '';
    let headerIndex = -1;
    let isPipeTable = false;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].raw.includes('\t')) {
            headerIndex = i;
            break;
        } else if (
            !/^[\-*]\s*/.test(lines[i].trimmed) &&
            lines[i].raw.includes('|') &&
            splitTabularCells(lines[i].raw, true).filter(cell => cell.length > 0).length >= 2
        ) {
            headerIndex = i;
            isPipeTable = true;
            break;
        }
    }

    if (headerIndex === -1) return null;

    if (headerIndex > 0) {
        const potentialTitle = lines.slice(0, headerIndex).map(line => line.trimmed).join(' ');
        if (potentialTitle.length <= 80) {
            title = potentialTitle;
        }
    }

    const rawHeaders = splitTabularCells(lines[headerIndex].raw, isPipeTable);
    const meaningfulHeaders = rawHeaders.filter(header => header.length > 0 && !/^[\-\=\_\*\s]{2,}$/.test(header));
    const headers = rawHeaders.map((header, index) => header || `Column ${index + 1}`);

    if (headers.length < 2 || meaningfulHeaders.length < 2 || headers.some(header => header.length > 50)) {
        return null;
    }

    const rows = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const cols = splitTabularCells(lines[i].raw, isPipeTable);
        const nonEmptyCols = cols.filter(cell => cell.length > 0);
        const isMarkdownDivider = isPipeTable &&
            nonEmptyCols.length > 0 &&
            nonEmptyCols.every(cell => /^:?-{3,}:?$/.test(cell));

        if (isMarkdownDivider) continue;

        if (cols.some(c => c.length > 0)) {
            while (cols.length < headers.length) cols.push('');
            rows.push(cols.slice(0, headers.length));
        }
    }

    if (!rows.length || !rows.some(r => r.filter(c => c.length > 0).length >= 2)) {
        return null;
    }

    return { title, headers, rows };
}

function parseRepeatedBlocksToTable(text) {
    if (!text || typeof text !== 'string') return null;

    const rawBlocks = text.split(/[\-]{10,}/).map(b => b.trim()).filter(b => b.length > 0);
    const blocks = rawBlocks.length > 0 ? rawBlocks : [text.trim()];

    const parsedBlocks = [];
    const allKeys = new Set();

    blocks.forEach(block => {
        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const obj = {};
        let validPairsCount = 0;
        lines.forEach(line => {
            if (/^[\-*]\s*/.test(line)) return;
            if (line.includes(':')) {
                const [key, ...rest] = line.split(':');
                const val = rest.join(':').trim();
                const k = key.trim();
                if (k.length > 0 && k.length <= 40 && val.length > 0) {
                    obj[k] = val;
                    allKeys.add(k);
                    validPairsCount++;
                }
            }
        });
        if (validPairsCount >= 3) {
            parsedBlocks.push(obj);
        }
    });

    if (parsedBlocks.length === 0 || allKeys.size < 3) return null;

    const headers = Array.from(allKeys);

    const rows = parsedBlocks.map(block => {
        return headers.map(h => block[h] || '');
    });

    return { title: 'Employee Data Records', headers, rows };
}

function parseKeyValueRemarkText(text) {
    if (!text || typeof text !== 'string') return null;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return null;

    const sections = [];
    let currentSection = { title: '', items: [], summary: '' };
    let inSummary = false;

    for (const line of lines) {
        if (/^[\-\=\_\*]{3,}$/.test(line)) continue;

        const summaryMatch = line.match(/^(?:[\-*]\s*)?summary\s*:\s*(.*)$/i);
        if (summaryMatch) {
            const inlineSummary = summaryMatch[1].trim();
            currentSection.summary = inlineSummary;
            inSummary = inlineSummary.length === 0;
            continue;
        }

        if (inSummary) {
            if (line.startsWith('-') || line.startsWith('*')) {
                currentSection.summary = line.replace(/^[\-\*]\s*/, '').trim();
            } else if (line.trim()) {
                currentSection.summary = line.trim();
            }
            inSummary = false;
            continue;
        }

        if (line.startsWith('-') || line.startsWith('*')) {
            const rawItem = line.replace(/^[\-\*]\s*/, '').trim();
            let key = '', val = '';

            if (rawItem.includes(':')) {
                const parts = rawItem.split(':');
                key = parts[0].trim();
                val = parts.slice(1).join(':').trim();
            } else if (rawItem.includes('|')) {
                const parts = rawItem.split('|');
                key = parts[0].trim();
                val = parts.slice(1).join('|').trim();
            }

            if (key && val) {
                currentSection.items.push({ key, val });
            }
        } else {
            if (!currentSection.title) {
                currentSection.title = line.replace(/[:]+$/, '').trim();
            } else if (currentSection.items.length > 0) {
                sections.push(currentSection);
                currentSection = { title: line.replace(/[:]+$/, '').trim(), items: [], summary: '' };
            }
        }
    }

    if (currentSection.items.length > 0) {
        sections.push(currentSection);
    }

    return sections.length > 0 ? sections : null;
}

function renderRemarkExcelDashboard(frm) {
    removeAfmcoDashboardSections(frm, '.remark-excel-dashboard, .remark-keyvalue-dashboard');

    try {
        const remarkText = frm.doc.remark || '';
        if (!remarkText.trim()) return;

        const parsedKV = parseKeyValueRemarkText(remarkText);
        if (parsedKV && parsedKV.length) {
            renderKeyValueDashboardCard(frm, parsedKV);
            return;
        }

        const repeatedData = parseRepeatedBlocksToTable(remarkText);
        if (repeatedData && repeatedData.rows && repeatedData.rows.length) {
            renderExcelDashboardCard(frm, repeatedData);
            return;
        }

        const parsedData = parseTabularRemarkText(remarkText);
        if (parsedData && parsedData.rows && parsedData.rows.length) {
            renderExcelDashboardCard(frm, parsedData);
            return;
        }
    } catch (err) {
        console.warn('[AFMCO Remark Parser] Graceful fallback on unexpected format:', err);
    }
}

function renderExcelDashboardCard(frm, parsedData) {
    const { title, headers, rows } = parsedData;
    const isSingleRow = rows.length === 1;

    let contentHtml = '';

    if (isSingleRow) {
        const row = rows[0];
        const gridItemsHtml = headers.map((h, colIdx) => {
            const val = row[colIdx] || '';
            if (!val || val === '-') return '';
            const lowerH = String(h).toLowerCase();
            let valClass = 'text-dark font-weight-bold';

            if (lowerH.includes('amount') || lowerH.includes('payable') || lowerH.includes('transfer') || lowerH.includes('fee')) {
                valClass = 'text-success font-weight-bold';
            } else if (lowerH.includes('deduction')) {
                valClass = 'text-danger font-weight-bold';
            }

            return `
                <div class="col-md-6 mb-2">
                    <div class="d-flex justify-content-between p-2 rounded" style="background-color: var(--control-bg);">
                        <span class="text-muted small">${escapeHtml(__(h))}:</span>
                        <span class="${valClass} small text-nowrap">${escapeHtml(val)}</span>
                    </div>
                </div>
            `;
        }).filter(item => item.length > 0).join('');

        contentHtml = `
            <div class="row pt-2">
                ${gridItemsHtml}
            </div>
        `;
    } else {
        const tableHeadersHtml = headers.map(h => {
            return `<th class="text-muted text-nowrap">${escapeHtml(__(h))}</th>`;
        }).join('');

        const tableRowsHtml = rows.map((row, idx) => {
            const cellsHtml = headers.map((h, colIdx) => {
                const val = row[colIdx] || '-';
                const lowerH = String(h).toLowerCase();

                if (lowerH.includes('amount') || lowerH.includes('payable') || lowerH.includes('transfer') || lowerH.includes('deduction') || lowerH.includes('fee')) {
                    return `<td class="text-right font-weight-bold text-nowrap">${escapeHtml(val)}</td>`;
                }
                if (lowerH.includes('account') || lowerH.includes('iban')) {
                    const cleanedIban = String(val).replace(/[\s\-_]+/g, '').toUpperCase();
                    return `<td class="font-monospace text-nowrap">${escapeHtml(cleanedIban || val)}</td>`;
                }
                return `<td class="text-nowrap">${escapeHtml(val)}</td>`;
            }).join('');

            return `<tr><td class="text-center text-muted">${idx + 1}</td>${cellsHtml}</tr>`;
        }).join('');

        const fullHeaders = `<th class="text-center text-muted" width="4%">#</th>${tableHeadersHtml}`;
        contentHtml = build_afmco_table(fullHeaders, tableRowsHtml);
    }

    const displayTitle = title || (isSingleRow ? __('Record Details') : __('Data Records'));
    const dashboardHtml = buildAfmcoCollapsibleSection({
        sectionKey: 'remark-excel-dashboard',
        wrapperClass: 'remark-excel-dashboard custom mb-3',
        title: displayTitle,
        meta: `(${rows.length} ${rows.length === 1 ? __('Record') : __('Records')})`,
        bodyHtml: contentHtml,
        bodyClass: 'pb-0 pt-2',
        collapsedByDefault: true
    });

    appendAfmcoDashboardSection(frm, dashboardHtml);
}

function renderKeyValueDashboardCard(frm, sections) {
    removeAfmcoDashboardSections(frm, '.remark-keyvalue-dashboard');

    const sectionsHtml = sections.map((sec, index) => {
        const itemsHtml = sec.items.map(item => {
            const kLower = String(item.key).toLowerCase();
            let valFormatted = item.val;
            let valClass = 'text-dark';

            if (kLower.includes('salary') || kLower.includes('amount') || kLower.includes('eos') || kLower.includes('allowance') || kLower.includes('reward')) {
                const isNum = !isNaN(parseFloat(item.val.replace(/,/g, '')));
                if (isNum) {
                    valFormatted = format_currency(parseFloat(item.val.replace(/,/g, '')));
                }
                valClass = 'font-weight-bold text-success';
            } else if (kLower.includes('deduction')) {
                valClass = 'font-weight-bold text-danger';
            }

            return `
                <div class="col-md-6 mb-2">
                    <div class="d-flex justify-content-between p-2 rounded" style="background-color: var(--control-bg);">
                        <span class="text-muted small">${escapeHtml(__(item.key))}</span>
                        <span class="${valClass} small">${escapeHtml(valFormatted)}</span>
                    </div>
                </div>
            `;
        }).join('');

        const summaryHtml = sec.summary ? `
            <div class="mt-2 text-muted small px-2">
                <strong>${__('Formula')}:</strong> <span class="font-monospace">${escapeHtml(sec.summary)}</span>
            </div>
        ` : '';

        const displayTitle = sec.title ? __(sec.title) : __('Request Breakdown');

        return buildAfmcoCollapsibleSection({
            sectionKey: `remark-keyvalue-section-${index}`,
            wrapperClass: 'mb-3',
            title: displayTitle,
            meta: `(${sec.items.length} ${__('Fields')})`,
            bodyClass: 'pb-2 pt-2',
            collapsedByDefault: true,
            bodyHtml: `
                <div class="row px-2 pt-2">
                    ${itemsHtml}
                </div>
                ${summaryHtml}
            `
        });
    }).join('');

    const dashboardHtml = `
        <div class="remark-keyvalue-dashboard custom mb-3">
            ${sectionsHtml}
        </div>
    `;

    appendAfmcoDashboardSection(frm, dashboardHtml);
}

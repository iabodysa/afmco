// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide('afmco.accounts_bot_choice');

(() => {
    const OPEN_EVENT = 'accounts_bot_choice';
    const CLOSE_EVENT = 'accounts_bot_choice_closed';
    const DONE_EVENT = 'accounts_bot_done';
    const JOURNAL_ENTRY_CREATED = 'Journal Entry Created';
    const ANSWER_METHOD = 'afmco.afmco.api.accounts_bot.answer_accounts_bot_choice';
    const DOCTYPE = 'Payment Requisition';
    const open = new Map();
    const waiting = [];
    let shownDone = null;

    function isChoice(choice) {
        return Boolean(choice && choice.pr && choice.q && Array.isArray(choice.buttons) && choice.buttons.length);
    }

    function reloadForm(pr) {
        const frm = window.cur_frm;
        if (frm && frm.doctype === DOCTYPE && frm.doc.name === pr && !frm.is_dirty()) frm.reload_doc();
    }

    function answer(choice, id, done) {
        frappe.call({
            method: ANSWER_METHOD,
            args: { name: choice.pr, q: choice.q, id },
            freeze: true,
            callback: () => {
                if (done) done();
            },
        });
    }

    function render($parent, choice, done) {
        $('<p class="mb-3"></p>').text(choice.text).appendTo($parent);
        choice.buttons.forEach((button) => {
            const drafted = button.id === choice.drafted;
            const $row = $('<div class="mb-2"></div>').appendTo($parent);
            const $button = $('<button type="button" class="btn btn-sm btn-block text-left"></button>')
                .addClass(drafted ? 'btn-primary' : 'btn-default')
                .on('click', () => answer(choice, button.id, done))
                .appendTo($row);
            $('<span></span>').text(button.label).appendTo($button);
            if (drafted) $('<span class="badge badge-light ml-2"></span>').text(__('Current draft')).appendTo($button);
            if (button.hint) $('<div class="small text-muted mt-1"></div>').text(button.hint).appendTo($row);
        });
    }

    function close(pr, q) {
        const shown = open.get(pr);
        if (shown && (!q || shown.q === q)) shown.dialog.hide();
    }

    function formLink($parent, doctype, name, label, dialog) {
        $('<a class="small"></a>')
            .attr('href', frappe.utils.get_form_link(doctype, name))
            .text(label)
            .on('click', () => dialog.hide())
            .appendTo($('<div class="mt-3"></div>').appendTo($parent));
    }

    function nextDone() {
        if (!open.size && !shownDone && waiting.length) showDone(waiting.shift());
    }

    function showDone(done) {
        if (open.size || shownDone) {
            waiting.push(done);
            return;
        }
        const created = done.status === JOURNAL_ENTRY_CREATED;
        const dialog = new frappe.ui.Dialog({
            title: created ? __('Accounts Bot finished') : __('Accounts Bot stopped'),
            fields: [{ fieldname: 'done', fieldtype: 'HTML' }],
        });
        const $body = dialog.fields_dict.done.$wrapper;
        $('<p class="mb-0"></p>')
            .text(
                created
                    ? __('The Accounts Bot created the Journal Entry for Payment Requisition {0}.', [done.pr])
                    : __('The Accounts Bot stopped on Payment Requisition {0} and needs your review.', [done.pr])
            )
            .appendTo($body);
        formLink($body, DOCTYPE, done.pr, __('Open Payment Requisition {0}', [done.pr]), dialog);
        if (created && done.journal_entry) {
            formLink($body, 'Journal Entry', done.journal_entry, __('Open Journal Entry {0}', [done.journal_entry]), dialog);
        }
        dialog.onhide = () => {
            if (shownDone && shownDone.dialog === dialog) shownDone = null;
            nextDone();
        };
        shownDone = { done, dialog };
        dialog.show();
    }

    function setAsideDone() {
        if (!shownDone) return;
        const { done, dialog } = shownDone;
        shownDone = null;
        waiting.unshift(done);
        dialog.hide();
    }

    function show(choice) {
        const shown = open.get(choice.pr);
        if (shown && shown.q === choice.q) return;
        const dialog = new frappe.ui.Dialog({
            title: frappe.utils.escape_html(choice.title),
            fields: [{ fieldname: 'choice', fieldtype: 'HTML' }],
        });
        const $body = dialog.fields_dict.choice.$wrapper;
        render($body, choice, () => dialog.hide());
        formLink($body, DOCTYPE, choice.pr, __('Open Payment Requisition {0}', [choice.pr]), dialog);
        dialog.onhide = () => {
            if (open.get(choice.pr) && open.get(choice.pr).dialog === dialog) open.delete(choice.pr);
            nextDone();
        };
        open.set(choice.pr, { q: choice.q, dialog });
        if (shown) shown.dialog.hide();
        setAsideDone();
        dialog.show();
    }

    afmco.accounts_bot_choice.render = render;

    $(document).on('app_ready', () => {
        frappe.realtime.on(OPEN_EVENT, (choice) => {
            if (!isChoice(choice)) return;
            show(choice);
            reloadForm(choice.pr);
        });
        frappe.realtime.on(DONE_EVENT, (done) => {
            if (!done || !done.pr) return;
            showDone(done);
            reloadForm(done.pr);
        });
        frappe.realtime.on(CLOSE_EVENT, (data) => {
            if (!data || !data.pr) return;
            close(data.pr, data.q);
            reloadForm(data.pr);
        });
    });
})();

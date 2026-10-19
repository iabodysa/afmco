// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.provide('afmco.accounts_bot_choice');

(() => {
    const OPEN_EVENT = 'accounts_bot_choice';
    const CLOSE_EVENT = 'accounts_bot_choice_closed';
    const ANSWER_METHOD = 'afmco.financial_operations.api.accounts_bot.answer_accounts_bot_choice';
    const DOCTYPE = 'Payment Requisition';
    const open = new Map();

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

    function show(choice) {
        const shown = open.get(choice.pr);
        if (shown && shown.q === choice.q) return;
        close(choice.pr);
        const dialog = new frappe.ui.Dialog({
            title: frappe.utils.escape_html(choice.title),
            fields: [{ fieldname: 'choice', fieldtype: 'HTML' }],
        });
        const $body = dialog.fields_dict.choice.$wrapper;
        render($body, choice, () => dialog.hide());
        $('<a class="small"></a>')
            .attr('href', frappe.utils.get_form_link(DOCTYPE, choice.pr))
            .text(__('Open Payment Requisition {0}', [choice.pr]))
            .on('click', () => dialog.hide())
            .appendTo($('<div class="mt-3"></div>').appendTo($body));
        dialog.onhide = () => {
            if (open.get(choice.pr) && open.get(choice.pr).dialog === dialog) open.delete(choice.pr);
        };
        open.set(choice.pr, { q: choice.q, dialog });
        dialog.show();
    }

    afmco.accounts_bot_choice.render = render;

    $(document).on('app_ready', () => {
        frappe.realtime.on(OPEN_EVENT, (choice) => {
            if (!isChoice(choice)) return;
            show(choice);
            reloadForm(choice.pr);
        });
        frappe.realtime.on(CLOSE_EVENT, (data) => {
            if (!data || !data.pr) return;
            close(data.pr, data.q);
            reloadForm(data.pr);
        });
    });
})();

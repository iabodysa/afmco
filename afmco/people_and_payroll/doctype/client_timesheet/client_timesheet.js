// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

const BOT_BUSY_STATUSES = ['Queued', 'Processing'];

frappe.ui.form.on('Client Timesheet', {
    refresh(frm) {
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

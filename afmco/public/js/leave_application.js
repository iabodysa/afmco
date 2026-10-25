frappe.ui.form.on('Leave Application', {
    setup: function(frm) {
        $(frm.wrapper).on('attachments_change', () => frm.events.toggle_signed_form_reminder(frm));
    },
    leave_type: function(frm) {
        frm.events.toggle_signed_form_reminder(frm);
    },
    toggle_signed_form_reminder: async function(frm) {
        const is_lwp = frm.doc.leave_type && !frm.get_docinfo().attachments?.length
            && (await frappe.db.get_value('Leave Type', frm.doc.leave_type, 'is_lwp')).message?.is_lwp;
        frm.$signed_form_reminder?.remove();
        frm.$signed_form_reminder = is_lwp
            ? frm.dashboard.set_headline_alert(__('Attach the leave form signed by the employee.', null, 'Leave Application'), 'orange', true)
            : null;
    },
    refresh: function(frm) {
        frm.events.toggle_signed_form_reminder(frm);
        if (frm.doc.docstatus == 1 && frm.doc.status === 'Approved') {
            if (frappe.user.has_role(['HR User', 'HR Manager'])) {
                const button_label = __('Rejoin After Leave', null, 'Leave Application');
                frm.add_custom_button(button_label, function () {
                    if (frm.doc.date_of_rejoing) {
                        frm.call('rejoin_after_leave', { date_of_rejoining: frm.doc.date_of_rejoing });
                        return;
                    }
                    frappe.prompt([
                        {
                            label: __('Date of Rejoining', null, 'Leave Application'),
                            fieldname: 'date_of_rejoing',
                            fieldtype: 'Date',
                            reqd: 1,
                            default: new Date(frappe.datetime.now_date())
                        }
                    ], function (values) {
                        frm.call('rejoin_after_leave', { date_of_rejoining: values.date_of_rejoing });
                    }, button_label, __('Submit'));
                }).addClass('btn-success');
            }
        }
    }
});
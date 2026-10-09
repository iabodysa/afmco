frappe.ui.form.on('Leave Application', {
    refresh: function(frm) {
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
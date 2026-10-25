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
        if (frm.doc.docstatus == 1 && frm.doc.status === 'Approved' && !frm.doc.date_of_rejoing
            && frappe.user.has_role(['HR User', 'HR Manager'])) {
            frm.add_custom_button(__('Rejoin After Leave', null, 'Leave Application'), function () {
                frappe.new_doc('Leave Resumption', { leave_application: frm.doc.name });
            }).addClass('btn-success');
        }
    }
});
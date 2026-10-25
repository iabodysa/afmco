// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.ui.form.on('Leave Resumption', {
    setup: function(frm) {
        frm.set_query('leave_application', () => ({ filters: { docstatus: 1, status: 'Approved' } }));
    }
});

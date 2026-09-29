frappe.ui.form.on('Sales Invoice', {
    validate: function(frm) {
        // Skip validation for Credit Notes - ERPNext flips signs automatically
        if (frm.doc.is_return) {
            return;
        }
        
        // Original validation for regular invoices only
        let has_negative = false;
        if (frm.doc.items) {
            frm.doc.items.forEach(item => {
                if (item.qty < 0 || item.rate < 0) {
                    has_negative = true;
                }
            });
        }
        if (has_negative || frm.doc.total < 0) {
            frappe.validated = false;
            frappe.throw({
                title: __('E-Invoicing Integration Requirement Violation', null, 'Sales Invoice'),
                indicator: 'red',
                message: __('<b>Data entry error:</b><br>Under ZATCA requirements, negative values may not be sent in XML files.<br><br>Please enter quantities and prices as <b>positive</b> values; the system processes them as a return automatically based on the document type.', null, 'Sales Invoice')
            });
        }
    }
});
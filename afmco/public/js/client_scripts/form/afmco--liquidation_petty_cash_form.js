frappe.ui.form.on('Liquidation Petty Cash', {
    refresh: function(frm) {
        if (frm.doc.workflow_state === 'Paid' && frm.doc.docstatus === 0) {
            frm.add_custom_button(
                __('Clear The Invoice'),
                () => frm.call('sync_to_petty_cash').then((r) => frappe.set_route('Form', 'Petty Cash', r.message))
            ).addClass('btn-danger');
        }
    }
});

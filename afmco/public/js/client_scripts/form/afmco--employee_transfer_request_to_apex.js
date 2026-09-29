// Employee Transfer Request moved to Apex as Transport Request; accountants stay for bulk payment orders
const ETR_APEX_URL = 'https://apex.afmco.sa/desk/transport-request';
const ETR_STAY_ROLES = ['Accounts User', 'Accounts Manager', 'Accountant'];

function etr_apex_url(name) {
    return name ? `${ETR_APEX_URL}?legacy_reference=${encodeURIComponent(name)}` : `${ETR_APEX_URL}/new`;
}

function etr_go_to_apex(url) {
    frappe.show_alert({ message: __('Employee Transfer Requests moved to Apex. Opening Apex...'), indicator: 'blue' });
    setTimeout(() => window.location.assign(url), 1200);
}

frappe.ui.form.on('Employee Transfer Request', {
    onload(frm) {
        if (frm.is_new()) {
            etr_go_to_apex(etr_apex_url());
            return;
        }
        if (!frappe.user.has_role(ETR_STAY_ROLES)) {
            etr_go_to_apex(etr_apex_url(frm.doc.name));
        }
    },
    refresh(frm) {
        if (frm.is_new()) return;
        frm.set_intro(__('This request moved to Apex as a Transport Request. New requests are created in Apex.'), 'blue');
        frm.add_custom_button(__('Open in Apex'), () => window.open(etr_apex_url(frm.doc.name), '_blank'));
    },
});

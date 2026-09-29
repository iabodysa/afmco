// Employee Transfer Request list sends everyone but accountants to the Apex Transport Request list
(() => {
    const APEX_LIST = 'https://apex.afmco.sa/desk/transport-request';
    const STAY_ROLES = ['Accounts User', 'Accounts Manager', 'Accountant'];

    const check = () => {
        const route = frappe.get_route();
        if (route[0] !== 'List' || route[1] !== 'Employee Transfer Request') return;
        if (frappe.user.has_role(STAY_ROLES)) {
            frappe.show_alert({ message: __('Employee Transfer Requests moved to Apex. This list stays for payment orders.'), indicator: 'blue' });
            return;
        }
        frappe.show_alert({ message: __('Employee Transfer Requests moved to Apex. Opening Apex...'), indicator: 'blue' });
        setTimeout(() => window.location.assign(APEX_LIST), 1200);
    };

    check();
    frappe.router.on('change', check);
})();

frappe.listview_settings['Employee'] = {
    get_indicator: function(doc) {
        // Set indicator for active employees with expired iqama
        if (doc.custom_iqama_expired == 1 && doc.status === 'Active') {
            return [__('Active'), 'orange', 'custom_iqama_expired,=,1'];
        }
        // Return null if no conditions are met
        return null;
    }
};
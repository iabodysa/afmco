frappe.listview_settings['Employee'] = {
    get_indicator: function(doc) {
        // Set indicator for active employees with expired iqama
        if (doc.iqama_expired == 1 && doc.status === 'Active') {
            return [__('Active'), 'orange', 'iqama_expired,=,1'];
        }
        // Return null if no conditions are met
        return null;
    }
};
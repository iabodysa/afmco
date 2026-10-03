frappe.ui.form.on('Iqama Renewal Management', {
    onload: function(frm) {
        frm.set_value('department', '');
        frm.set_value('corporation', '');
        frm.clear_table('employees_details');
        frm.refresh_field('employees_details');
        fetch_and_set_queries(frm);
    },

    department: function(frm) {
        if (frm.doc.department) {
            frm.clear_table('employees_details');
            frm.refresh_field('employees_details');
            fetch_and_fill_child_table(frm); // Fetch data when department changes
            frm.toggle_display('corporation', !frm.doc.department);
        }
    },

    corporation: function(frm) {
        if (frm.doc.corporation) {
            frm.clear_table('employees_details');
            frm.refresh_field('employees_details');
            fetch_and_fill_child_table(frm); // Fetch data when corporation changes
            frm.toggle_display('department', !frm.doc.corporation);
        }
    }
});

// Function to fetch and set queries for department and corporation fields
function fetch_and_set_queries(frm) {
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Iqama Renewal Fee Tracking',
            filters: {
                'status': 'New'
            },
            fields: ['department', 'corporation'],
            limit_page_length: 1000
        },
        callback: function(r) {
            if (r.message) {
                let departments = [];
                let corporations = [];

                r.message.forEach(function(record) {
                    if (record.department && !departments.includes(record.department)) {
                        departments.push(record.department);
                    }
                    if (record.corporation && !corporations.includes(record.corporation)) {
                        corporations.push(record.corporation);
                    }
                });

                frm.set_query('department', function() {
                    return {
                        filters: {
                            'name': ['in', departments]
                        }
                    };
                });

                frm.set_query('corporation', function() {
                    return {
                        filters: {
                            'name': ['in', corporations]
                        }
                    };
                });
            }
        }
    });
}

// Function to fetch data and fill the child table
function fetch_and_fill_child_table(frm) {
    let filters = [['status', '=', 'New']];

    // Add filter for department if it is filled
    if (frm.doc.department) {
        filters.push(['department', '=', frm.doc.department]);
    }

    // Add filter for corporation if it is filled
    if (frm.doc.corporation) {
        filters.push(['corporation', '=', frm.doc.corporation]);
    }

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Iqama Renewal Fee Tracking',
            filters: filters,
            fields: ['employee', 'employee_name', 'iqama_expiration_date', 'department', 'cost_center', 'company_name', 'corporation', 'file_no', 'name'],
            limit_page_length: 1000
        },
        callback: function(r) {
            if (r.message && r.message.length > 0) {
                frm.clear_table('employees_details');
                r.message.forEach(function(d) {
                    let child = frm.add_child('employees_details');
                    child.employee = d.employee;
                    child.employee_name = d.employee_name;
                    child.iqama_expiration_date = d.iqama_expiration_date;
                    child.department = d.department;
                    child.cost_center = d.cost_center;
                    child.company_name = d.company_name;
                    child.corporation = d.corporation;
                    child.file_no = d.file_no;
                    child.name1 = d.name; // Store the document's name in the 'name1' field for later updates
                });
                frm.refresh_field('employees_details');
                frappe.show_alert({message: __('Data fetched successfully.', null, 'Iqama Renewal Management'), indicator: 'green'});
            } else {
                frappe.show_alert({message: __('No data found to fetch.', null, 'Iqama Renewal Management'), indicator: 'orange'});
            }
        }
    });
}

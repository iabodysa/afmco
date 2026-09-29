frappe.ui.form.on('Task', {
    refresh: function(frm) {
        if (frm.doc.status === 'Completed' && (frappe.user_roles.includes("Accounts Manager") || frappe.user_roles.includes("General Manager") || frappe.user_roles.includes("Projects Manager") || frappe.user_roles.includes("HR Manager"))) {
            frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Energy Point Log",
                    fields: ["name", "points"],
                    filters: {
                        "reference_doctype": "Task",
                        "reference_name": frm.doc.name
                    },
                    limit_page_length: 1 
                },
                callback: function(r) {
                    if (r.message && r.message.length === 0) {
                        let btn = frm.add_custom_button("Add Energy Point", function() {
                            frappe.prompt([
                                {'fieldname': 'points', 'fieldtype': 'Int', 'label': 'Energy Points', 'reqd': 1}
                            ],
                            function(values){
                                frappe.call({
                                    method: "frappe.client.insert",
                                    args: {
                                        doc: {
                                            "doctype": "Energy Point Log",
                                            "user": frm.doc.created_by,
                                            "reference_doctype": "Task",
                                            "reference_name": frm.doc.name,
                                            "type": "Appreciation",
                                            "points": values.points
                                        }
                                    },
                                    callback: function(r) {
                                        if (r.message) {
                                            frappe.msgprint("Energy points added successfully.");
                                            frm.reload_doc();
                                        }
                                    }
                                });
                            },
                            'Add Energy Points',
                            'Add');
                        });
                        btn.addClass('btn-primary');
                    } else if (r.message && r.message.length === 1) {
                        let log = r.message[0];
                        let btn = frm.add_custom_button("Edit Energy Point Log", function() {
                            frappe.prompt([
                                {'fieldname': 'points', 'fieldtype': 'Int', 'label': 'Energy Points', 'reqd': 1, 'default': log.points}
                            ],
                            function(values){
                                frappe.call({
                                    method: "frappe.client.set_value",
                                    args: {
                                        doctype: "Energy Point Log",
                                        name: log.name,
                                        fieldname: "points",
                                        value: values.points
                                    },
                                    callback: function(r) {
                                        if (r.message) {
                                            frappe.msgprint("Energy points updated successfully.");
                                            frm.reload_doc();
                                        }
                                    }
                                });
                            },
                            'Edit Energy Points',
                            'Save');
                        });
                        btn.addClass('btn-danger');
                    } else {
                        frappe.msgprint({
                            message: "There was an error fetching the Energy Point Logs. Please try again.",
                            indicator: 'red',
                            title: 'Error'
                        });
                    }
                },
                error: function() {
                    frappe.msgprint({
                        message: "Failed to make server request. Please check your network connection.",
                        indicator: 'red',
                        title: 'Connection Error'
                    });
                }
            });
        }
    }
});

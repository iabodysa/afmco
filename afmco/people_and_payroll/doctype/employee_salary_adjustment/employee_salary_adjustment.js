frappe.ui.form.on('Employee Salary Adjustment', {
    refresh(frm) {
        if (!frm.doc.__islocal) {
            frm.add_custom_button(__('Fetch Salary'), () => {
                frm.trigger('fetch_salary_dialog');
            });
        }
    },

    onload: function(frm) {
        frm.set_query("employee", function() {
            return {
                "filters": {
                    "status": "Active"
                }
            };
        });
    },

    fetch_salary_dialog: function(frm) {
        if (frm.doc.employee) {
            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Salary Slip',
                    fields: ['name', 'gross_pay', 'start_date', 'end_date'],
                    filters: {
                        employee: frm.doc.employee
                    },
                    order_by: 'start_date desc',
                    limit: 5
                },
                callback: function(response) {
                    if (response.message && response.message.length > 0) {
                        let last_five_salaries = response.message.map(slip => ({
                            label: `${slip.start_date} - ${slip.end_date}: ${slip.gross_pay} SAR`,
                            value: slip.name
                        }));

                        frappe.call({
                            method: 'frappe.client.get_list',
                            args: {
                                doctype: 'Salary Slip',
                                fields: ['name', 'gross_pay', 'start_date', 'end_date'],
                                filters: {
                                    employee: frm.doc.employee
                                },
                                order_by: 'start_date desc'
                            },
                            callback: function(all_salaries_response) {
                                if (all_salaries_response.message && all_salaries_response.message.length > 0) {
                                    let all_salaries = all_salaries_response.message.map(slip => ({
                                        label: `${slip.start_date} - ${slip.end_date}: ${slip.gross_pay} SAR`,
                                        value: slip.name
                                    }));

                                    frappe.prompt([
                                        {
                                            label: __('Last Month Salary'),
                                            fieldname: 'last_month_salary',
                                            fieldtype: 'Select',
                                            options: last_five_salaries
                                        },
                                        {
                                            label: __('All Salaries'),
                                            fieldname: 'all_salaries',
                                            fieldtype: 'Select',
                                            options: all_salaries
                                        }
                                    ], (values) => {
                                        let selected_last_month_salary = response.message.find(slip => slip.name === values.last_month_salary);
                                        frm.set_value('last_month_salary', selected_last_month_salary.gross_pay);

                                        let selected_all_salaries = all_salaries_response.message.find(slip => slip.name === values.all_salaries);
                                        frm.set_value('last_month_salary_last_year', selected_all_salaries.gross_pay);
                                    }, __('Select Salaries'), __('Select'));
                                } else {
                                    frappe.msgprint(__('No Salary Slips found.'));
                                }
                            }
                        });
                    } else {
                        frappe.msgprint(__('No Salary Slips found.'));
                    }
                }
            });
        } else {
            frappe.msgprint(__('Please select an Employee.'));
        }
    }
});

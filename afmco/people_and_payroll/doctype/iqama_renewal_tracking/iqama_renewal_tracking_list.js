frappe.listview_settings['Iqama Renewal Tracking'] = {
    add_fields: ["status"],
    get_indicator: function(doc) {
        let status_color = {
            "New": "green",
            "Awaiting Operations Approval": "orange",
            "Waiting for Legal Approval": "blue",
            "Awaiting Payment": "yellow",
            "Awaiting Renewal": "purple",
            "Issue Preventing Renewal": "red",
            "Renewed": "blue",
            "Rejected": "darkgrey",
            "Unknown": "gray",
        };

        let color = status_color[doc.status] || status_color["Unknown"];
        return [__(doc.status), color, "status,=," + doc.status];
    },
    onload: function(listview) {
        add_dashboard(listview);
        
        listview.page.add_actions_menu_item(__('Copy to Clipboard'), function() {
            let selected_docs = listview.get_checked_items();
            if (selected_docs.length === 0) {
                frappe.msgprint(__('Please select documents to export.'));
                return;
            }
            copy_to_clipboard_as_markdown(selected_docs);
        });
        // Approve Renewal button
        listview.page.add_inner_button(__('Approve Renewal'), function() {
            let selected_docs = listview.get_checked_items();
            if (selected_docs.length === 0) {
                frappe.msgprint(__('Please select documents to approve renewal.'));
                return;
            }
        
            // Filter out documents that do not have status New
            let invalid_docs = selected_docs.filter(doc => doc.status !== 'New');
            let valid_docs = selected_docs.filter(doc => doc.status === 'New');
        
            // Notify user if there are any invalid documents
            if (invalid_docs.length > 0) {
                frappe.msgprint(__('Please select only documents with status New.'));
                return;
            }
        
            (async function update_status(docs, new_status) {
                for (const doc of docs) {
                    try {
                        await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'status', new_status);
                    } catch (error) {
                        console.error("Error updating status for doc:", doc.name, error);
                        frappe.msgprint(__('Error updating status for: ') + doc.name);
                    }
                }
                frappe.msgprint(__('Status updated to: ') + new_status);
                listview.refresh();
            })(valid_docs, 'Awaiting Operations Approval');
        }, __("Tools"));
        // Reject Renewal button
        listview.page.add_inner_button(__('Reject Renewal'), function() {
            let selected_docs = listview.get_checked_items();
            if (selected_docs.length === 0) {
                frappe.msgprint(__('Please select documents to reject renewal.'));
                return;
            }

            (async function update_status(docs, new_status) {
                for (const doc of docs) {
                    try {
                        await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'status', new_status);
                    } catch (error) {
                        console.error("Error updating status for doc:", doc.name, error);
                        frappe.msgprint(__('Error updating status for: ') + doc.name);
                    }
                }
                frappe.msgprint(__('Status updated to: ') + new_status);
                listview.refresh();
            })(selected_docs, 'Rejected');
        }, __("Tools"));
        // Update Renewal Preference button
        listview.page.add_inner_button(__('Update Renewal Preference'), function() {
            let selected_docs = listview.get_checked_items();
            if (selected_docs.length === 0) {
                frappe.msgprint(__('Please select documents to update Renewal Preference.'));
                return;
            }
    // Filter out documents that do not have status Awaiting Operations Approval
    let invalid_docs = selected_docs.filter(doc => doc.status !== 'Awaiting Operations Approval');
    let valid_docs = selected_docs.filter(doc => doc.status === 'Awaiting Operations Approval');

        // Notify user if there are any invalid documents
        if (invalid_docs.length > 0) {
            frappe.msgprint(__('Please select only documents with status Awaiting Operations Approval.'));
            return;
        }
    
        frappe.prompt(
            [
                {
                    'fieldname': 'renewal_preference',
                    'fieldtype': 'Select',
                    'label': __('Renewal Preference'),
                    'options': frappe.meta.get_docfield('Iqama Renewal Tracking', 'renewal_preference').options
                        .split('\n').filter(Boolean).map(value => ({'label': __(value), 'value': value})),
                    'reqd': 1
                },
                {
                    'fieldname': 'renewal_duration',
                    'fieldtype': 'Select',
                    'label': __('Renewal Duration'),
                    'options': frappe.meta.get_docfield('Iqama Renewal Tracking', 'renewal_duration').options
                        .split('\n').filter(Boolean).map(value => ({'label': __(value), 'value': value})),
                    'depends_on': 'eval:doc.renewal_preference == "Yes"',
                    'reqd': 0
                },
                {
                    'fieldname': 'reason_of_not_renew',
                    'fieldtype': 'Small Text',
                    'label': __('Reason of Not Renewal'),
                    'depends_on': 'eval:doc.renewal_preference && doc.renewal_preference != "Yes"',
                    'reqd': 0
                }
            ],
            async function(values) {
                if (values.renewal_preference === 'Yes' && !values.renewal_duration) {
                    frappe.msgprint(__('Renewal Duration is required when Renewal Preference is Yes.'));
                    return;
                }
                if (values.renewal_preference !== 'Yes' && !values.reason_of_not_renew) {
                    frappe.msgprint(__('Reason of Not Renewal is required when Renewal Preference is No.'));
                    return;
                }
    
                for (const doc of valid_docs) {
                    try {
                        let frm = await frappe.db.get_doc('Iqama Renewal Tracking', doc.name);
    
                        // Update renewal preference and related fields
                        await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'renewal_preference', values.renewal_preference);
                        if (values.renewal_preference === 'Yes') {
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'renewal_duration', values.renewal_duration);
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'status', 'Awaiting Payment');
                        } else {
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'reason_of_not_renew', values.reason_of_not_renew);
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'status', 'Rejected');
                        }
                        // Calculate fees and update related fields
                        let iqama_fee = 0;
                        let work_permit_fee = 0;
                        let months = 0;
                        if (values.renewal_preference === 'Yes') {
                            switch (values.renewal_duration) {
                                case '3 months':
                                    months = 3;
                                    break;
                                case '6 months':
                                    months = 6;
                                    break;
                                case '9 Months':
                                    months = 9;
                                    break;
                                case '1 year':
                                    months = 12;
                                    break;
                                default:
                                    months = 0;
                            }
    
                            switch (months) {
                                case 3:
                                    work_permit_fee = 2425.00;
                                    break;
                                case 6:
                                    work_permit_fee = 4850.00;
                                    break;
                                case 9:
                                    work_permit_fee = 7275.00;
                                    break;
                                case 12:
                                    work_permit_fee = 9700.00;
                                    break;
                                default:
                                    continue;
                            }
    
                            switch (months) {
                                case 3:
                                    iqama_fee = 163.00;
                                    break;
                                case 6:
                                    iqama_fee = 325.00;
                                    break;
                                case 9:
                                    iqama_fee = 488.00;
                                    break;
                                case 12:
                                    iqama_fee = 650.00;
                                    break;
                                default:
                                    continue;
                            }
    
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'iqama_renewal_amount', iqama_fee);
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'work_permit_fee', work_permit_fee);
    
                            let total = iqama_fee + work_permit_fee + (frm.traffic_violation_balance || 0);
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'total_amount', total.toFixed(2));
    
                            // Update Muqeem Balance After Renewal and Refundable Balance fields
                            let renewal_amount = iqama_fee;
                            let muqeem_balance = frm.muqeem_balance || 0;
    
                            if (frm.status === 'Renewed') {
                                await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'muqeem_balance_after_renewal', muqeem_balance);
                            } else {
                                await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'muqeem_balance_after_renewal', muqeem_balance + renewal_amount);
                            }
    
                            let muqeem_balance_after_renewal = muqeem_balance + renewal_amount;
                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'refundable_balance', muqeem_balance_after_renewal > 0 ? 1 : 0);
                        }
    
                    } catch (error) {
                        console.error("Error updating Renewal Preference for doc:", doc.name, error);
                        frappe.msgprint(__('Error updating Renewal Preference for: ') + doc.name);
                    }
                }
                frappe.msgprint(__('Renewal Preference updated successfully.'));
                listview.refresh();
            },
            __('Enter Renewal Preference'),
            __('Update')
        );
    }, __("Tools"));
        // Update SADAD Number and Exemption Status button
        listview.page.add_inner_button(__('Update SADAD Number'), function() {
            let selected_docs = listview.get_checked_items();
                if (selected_docs.length === 0) {
                    frappe.msgprint(__('Please select documents to update SADAD number or exemption status.'));
                    return;
                }
            
                frappe.prompt(
                    [
                        {
                            'fieldname': 'sadad_number',
                            'fieldtype': 'Data',
                            'label': __('SADAD Number'),
                            'reqd': 1
                        },
                        {
                            'fieldname': 'exempt_compensation',
                            'fieldtype': 'Check',
                            'label': __('Exempt from Financial Compensation')
                        }
                    ],
                    function(values) {
                        (async function update_sadad_and_exemption(docs, sadad_number, exempt_compensation) {
                            for (const doc of docs) {
                                try {
                                    // Fetch the document to get the current values
                                    let iqama_doc = await frappe.db.get_doc('Iqama Renewal Tracking', doc.name);
                                    
                                    // Update SADAD number
                                    await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'sadad_invoice', sadad_number);
                                    
                                    // Update exemption status
                                    let new_status = exempt_compensation ? 1 : 0;
                                    await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'exempt_compensation', new_status);
            
                                    // Check and update renewal duration and work permit fee if exempted
                                    if (new_status) {
                                        if (iqama_doc.renewal_duration !== '1 year') {
                                            frappe.msgprint(__('Duration must be 1 year for exempted cases.'));
                                            await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'renewal_duration', '1 year');
                                        }
                                        await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'work_permit_fee', 100.00);
                                    }
            
                                } catch (error) {
                                    console.error("Error updating SADAD number or exemption status for doc:", doc.name, error);
                                    frappe.msgprint(__('Error updating SADAD number or exemption status for: ') + doc.name);
                                }
                            }
                            frappe.msgprint(__('SADAD number and exemption status updated successfully.'));
                            listview.refresh();
                        })(selected_docs, values.sadad_number, values.exempt_compensation);
                    },
                    __('Enter SADAD Number & Exemption Status'),
                    __('Update')
                );
            }, __("Tools"));
        // Create Payment Request button
        listview.page.add_inner_button(__('Create Payment Request'), function() {
            let selected_docs = listview.get_checked_items();
            if (selected_docs.length === 0) {
                frappe.msgprint(__('Please select documents to create payment request.'));
                return;
            }
        
            // Filter out documents with iqama_renewal_issue = 1
            let excluded_docs = selected_docs.filter(doc => doc.iqama_renewal_issue == 1);
            let valid_docs = selected_docs.filter(doc => doc.iqama_renewal_issue != 1);
        
            // Notify user about excluded documents
            if (excluded_docs.length > 0) {
                excluded_docs.forEach(doc => {
                    frappe.msgprint(__('Employee {0} excluded due to renewal issue.', [doc.employee_name]));
                });
            }
        
            // Filter out documents that do not have status Awaiting Payment
            valid_docs = valid_docs.filter(doc => doc.status === 'Awaiting Payment');
            if (valid_docs.length === 0) {
                frappe.msgprint(__('Please select documents with status Awaiting Payment.'));
                return;
            }
        
            frappe.prompt(
                [
                    {
                        'fieldname': 'payment_type',
                        'fieldtype': 'Select',
                        'label': __('Payment Type'),
                        'options': [
                            {'label': __('PR Created for Work Cards'), 'value': 'PR Created for Work Cards'},
                            {'label': __('PR Created for Iqama Renewal'), 'value': 'PR Created for Iqama Renewal'}
                        ],
                        'reqd': 1
                    }
                ],
                function(values) {
                    (async function create_bulk_payment_request(docs, payment_type) {
                        const messages = {
                            pr_created: __('Payment Request Created', null, 'Iqama Renewal Tracking'),
                            error_message: __('Error creating Payment Request for:', null, 'Iqama Renewal Tracking') + ' '
                        };
        
                        let errorList = [];
                        let successList = [];
                        let remarks = '';
                        let total_amount = 0;
        
                        // Filter documents based on payment type and pr_status
        /*               docs = docs.filter(doc => {
                            if ((payment_type === 'PR Created for Work Cards' && (doc.pr_status === 'PR Created for Work Cards' || doc.pr_status === 'PR Created for Both Work Cards and Iqama Renewal')) ||
                                (payment_type === 'PR Created for Iqama Renewal' && (doc.pr_status === 'PR Created for Iqama Renewal' || doc.pr_status === 'PR Created for Both Work Cards and Iqama Renewal'))) {
                                frappe.msgprint(__('Payment Request already created for document {0} for employee {1}.', [doc.name, doc.employee_name]));
                                return false;
                            }
                            return true;
                        }); */
                        docs = docs.filter(doc => {
                            const already_created = (
                                (payment_type === 'PR Created for Work Cards' &&
                                    (doc.pr_status === 'PR Created for Work Cards' || doc.pr_status === 'PR Created for Both Work Cards and Iqama Renewal')) ||
                                (payment_type === 'PR Created for Iqama Renewal' &&
                                    (doc.pr_status === 'PR Created for Iqama Renewal' || doc.pr_status === 'PR Created for Both Work Cards and Iqama Renewal'))
                            );
                        
                            if (already_created) {
                                frappe.msgprint(__('Payment Request already created for document {0} for employee {1}.', [doc.name, doc.employee_name]));
                                return false;
                            }
                        
                           // if (doc.employee_status !== 'Active') {
                            if (doc.employee_status !== 'Active') {
                                frappe.msgprint(__('Cannot create Payment Request for document {0} because employee {1} is not Active.', [doc.name, doc.employee_name]));
                                return false;
                            }
                        
                            return true;
                        });

        
                        // Process each document
                        for (const doc of docs) {
                            try {
                                let frm = await frappe.db.get_doc('Iqama Renewal Tracking', doc.name);
        
                                // Check if SADAD invoice is missing for PR Created for Work Cards
                                if (payment_type === 'PR Created for Work Cards' && !frm.sadad_invoice) {
                                    frappe.msgprint(__('Document {0} for employee {1} has no SADAD number. Please try again after adding the SADAD number.', [frm.name, frm.employee_name]));
                                    continue;
                                }
        
                                // Collect document details for remarks
                                if (frm.employee) remarks += `Employee: ${frm.employee}\n`;
                                if (frm.employee_name) remarks += `Employee Name: ${frm.employee_name}\n`;
                                if (frm.iqama_expiration_date) remarks += `Iqama Expiration Date: ${frm.iqama_expiration_date}\n`;
                                if (frm.iqama_new_expiration_date) remarks += `New Iqama Expiration Date: ${frm.iqama_new_expiration_date}\n`;
                                if (frm.renewal_duration) remarks += `Renewal Duration: ${frm.renewal_duration}\n`;
                                if (frm.cost_center) remarks += `Cost Center: ${frm.cost_center}\n`;
                                if (frm.department) remarks += `Department: ${frm.department}\n`;
                                if (frm.corporation) remarks += `Corporation: ${frm.corporation}\n`;
        
                                // Add specific remarks and update total amount based on payment type
                                if (payment_type === 'PR Created for Work Cards') {
                                    if (frm.sadad_invoice) remarks += `SADAD Invoice: ${frm.sadad_invoice}\n`;
                                    if (frm.work_permit_fee) {
                                        remarks += `Work Permit Fee: ${frm.work_permit_fee}\n`;
                                        total_amount += parseFloat(frm.work_permit_fee);
                                    }
                                } else if (payment_type === 'PR Created for Iqama Renewal') {
                                    if (frm.iqama_renewal_amount) {
                                        remarks += `Iqama Renewal Amount: ${frm.iqama_renewal_amount}\n`;
                                        total_amount += parseFloat(frm.iqama_renewal_amount);
                                    }
                                }
        
                                remarks += '------------------------\n';
                                successList.push(frm.name);
        
                            } catch (error) {
                                errorList.push(doc.name);
                                frappe.msgprint(messages.error_message + doc.name);
                            }
                        }
        
                        if (successList.length > 0) {
                            // Create a new Expense Request
                            //const paymentRequest = frappe.model.get_new_doc('Payment Requisition');
                            let paymentRequest = frappe.model.get_new_doc('Payment Requisition'); // new
                            paymentRequest.beneficiary_name = payment_type === 'PR Created for Work Cards' ? 'وزارة الموارد البشرية (مكتب العمل)' : 'خدمات المقيمين وزارة الداخلية';
                            paymentRequest.amount = total_amount;  // Total amount calculated from all documents
                            paymentRequest.project = 'الادارة رئيسي - Head Office - AF';
                            paymentRequest.cost_center = 'الادارة رئيسي - Head Office - AF';
                            paymentRequest.jv_status = 'JV Not Created';
                            paymentRequest.naming_series = 'PR-.YYYY.-';
                            paymentRequest.bank_payment_date = frappe.datetime.nowdate();
                            paymentRequest.mode_of_payment = 'SADAD Payment';
                            paymentRequest.remark = remarks;
                            paymentRequest.multiple_beneficiaries = 1;
                            paymentRequest.payment_approver = 'Human Resources - الموارد البشرية';  //new
        
                            try {
                                // Redirect to the new Expense Request form
                                //frappe.set_route('Form', paymentRequest.doctype, paymentRequest.name);
                                paymentRequest = await frappe.xcall('afmco.people_and_payroll.api.iqama_bank_file.create_payment_requisition', {
                                    payment_requisition: paymentRequest,
                                    payment_type: payment_type,
                                    trackers: successList
                                });

                                await frappe.model.set_value(paymentRequest.doctype, paymentRequest.name, 'remark', paymentRequest.remark);
                                //frappe.msgprint(messages.pr_created[lang]);
        
                                // Update the status and PR status for each document
                                for (const name of successList) {
                                    let frm = await frappe.db.get_doc('Iqama Renewal Tracking', name);
                                    let new_pr_status = '';
                                    if (payment_type === 'PR Created for Work Cards') {
                                        if (frm.pr_status === 'PR Created for Iqama Renewal') {
                                            new_pr_status = 'PR Created for Both Work Cards and Iqama Renewal';
                                        } else {
                                            new_pr_status = 'PR Created for Work Cards';
                                        }
                                    } else if (payment_type === 'PR Created for Iqama Renewal') {
                                        if (frm.pr_status === 'PR Created for Work Cards') {
                                            new_pr_status = 'PR Created for Both Work Cards and Iqama Renewal';
                                        } else {
                                            new_pr_status = 'PR Created for Iqama Renewal';
                                        }
                                    }
                                    await frappe.db.set_value('Iqama Renewal Tracking', name, 'pr_status', new_pr_status);
                                    if (payment_type === 'PR Created for Work Cards') {
                                        await frappe.db.set_value('Iqama Renewal Tracking', name, 'pr_reference', paymentRequest.name);
                                    } else if (payment_type === 'PR Created for Iqama Renewal') {
                                        await frappe.db.set_value('Iqama Renewal Tracking', name, 'pr_reference_2', paymentRequest.name);
                                    }
                                    await frappe.db.set_value('Iqama Renewal Tracking', name, 'status', 'Awaiting Payment');
                                }
                                frappe.show_alert({
                                    message: __('Payment Requisition {0} created', [paymentRequest.name], 'Iqama Renewal Tracking'),
                                    indicator: 'green'
                                }, 10);
                                frappe.set_route('Form', paymentRequest.doctype, paymentRequest.name);
                            } catch (error) {
                                console.error("Error opening payment request form:", error);
                                frappe.msgprint(messages.error_message + successList.join(', '));
                            }
                        }
        
                        if (errorList.length > 0) {
                            frappe.msgprint(__('Errors encountered for documents: ') + errorList.join(', '));
                        }
                    })(valid_docs, values.payment_type);
                },
                __('Select Payment Type'),
                __('Create')
            );
        }, __("Tools"));
        // Confirm Payment button
        listview.page.add_inner_button(__('Confirm Payment'), function() {
    let selected_docs = listview.get_checked_items();
    if (selected_docs.length === 0) {
        frappe.msgprint(__('Please select documents to confirm payment.'));
        return;
    }

    // Filter out documents that do not have status Awaiting Payment
    let valid_docs = selected_docs.filter(doc => doc.status === 'Awaiting Payment');
    if (valid_docs.length === 0) {
        frappe.msgprint(__('Please select documents with status Awaiting Payment.'));
        return;
    }

    // Update status to Awaiting Renewal
    (async function update_status(docs) {
        const new_status = 'Awaiting Renewal';  // Define the new status here
        for (const doc of docs) {
            try {
                await frappe.db.set_value('Iqama Renewal Tracking', doc.name, 'status', new_status);
            } catch (error) {
                console.error("Error updating status for doc:", doc.name, error);
                frappe.msgprint(__('Error updating status for: ') + doc.name);
            }
        }
        frappe.msgprint(__('Status updated to: ') + new_status);
        listview.refresh();
    })(valid_docs);
}, __("Tools"));
    }
};

function copy_to_clipboard_as_markdown(docs) {
    // Create the table header
    let html_data = `<table border="1" style="border-collapse: collapse; width: 100%;">`;
    html_data += `<thead>
                    <tr>
                        <th>Employee Name</th>
                        <th>Employee</th>
                        <th>Department</th>
                        <th>Cost Center</th>
                        <th>Iqama Expiration Date</th>
                        <th>Corporation</th>
                    </tr>
                  </thead>`;
    html_data += `<tbody>`;

    // Create the table rows
    docs.forEach(doc => {
        html_data += `<tr>
                        <td>${doc.employee_name || ''}</td>
                        <td>${doc.employee || ''}</td>
                        <td>${doc.department || ''}</td>
                        <td>${doc.cost_center || ''}</td>
                        <td>${doc.iqama_expiration_date || ''}</td>
                        <td>${doc.corporation || ''}</td>
                      </tr>`;
    });

    html_data += `</tbody></table>`;

    // Create a temporary element to hold the HTML
    let tempElement = document.createElement('div');
    tempElement.innerHTML = html_data;
    document.body.appendChild(tempElement);

    // Copy the HTML to the clipboard
    let range = document.createRange();
    range.selectNode(tempElement);
    window.getSelection().removeAllRanges();  // Clear current selection
    window.getSelection().addRange(range);    // Select the text

    try {
        // Copy the selection to clipboard
        let successful = document.execCommand('copy');
        if (successful) {
            frappe.msgprint(__('Data copied to clipboard.'));
        } else {
            frappe.msgprint(__('Failed to copy data to clipboard.'));
        }
    } catch (err) {
        console.error('Could not copy text: ', err);
        frappe.msgprint(__('Failed to copy data to clipboard.'));
    }

    // Cleanup
    document.body.removeChild(tempElement);
    window.getSelection().removeAllRanges(); // Deselect the text
}

async function add_dashboard(listview) {
    frappe.require('iqama_renewal_tracking_dashboard.bundle.css');

    if (!listview.dashboard_area) {
        listview.dashboard_area = $('<div class="iqama-dashboard"></div>')
            .prependTo(listview.page.main);
    } else {
        listview.dashboard_area.empty();
    }

    const stats_config = get_full_stat_config();

    stats_config.forEach(stat => {
        render_dashboard_item(listview, stat, null);
    });

    const promises = stats_config.map(stat =>
        frappe.db.count(stat.doctype, { filters: stat.filters })
    );

    const results = await Promise.allSettled(promises);

    results.forEach((result, index) => {
        const stat = stats_config[index];
        const item = listview.dashboard_area.find(`.iqama-stat:eq(${index})`);

        if (result.status === 'fulfilled') {
            update_dashboard_item_count(item, result.value);
        } else {
            console.error(`Error loading stats for ${stat.label}`, result.reason);
            update_dashboard_item_error(item);
        }
    });
}

function render_dashboard_item(listview, stat, count) {
    const isLoading = count === null;
    const displayCount = isLoading ? '<span class="iqama-stat-skeleton"></span>' : count;

    const item = $(`
        <div class="widget number-widget-box iqama-stat ${stat.type} ${isLoading ? 'loading' : ''}"
             title="${__('Click to view list for')} ${stat.label}"
             data-stat-index="${listview.dashboard_area.children().length}">
            <div class="widget-head">
                <div class="widget-label">
                    <div class="widget-title">${stat.label}</div>
                </div>
                <span class="iqama-stat-icon">${frappe.utils.icon(stat.icon, 'sm')}</span>
            </div>
            <div class="widget-body">
                <div class="widget-content">
                    <div class="number">${displayCount}</div>
                </div>
            </div>
        </div>
    `).appendTo(listview.dashboard_area);

    if (!isLoading) {
        item.on('click', () => {
            const filterObj = {};
            stat.filters.forEach(filter => {
                if (filter.length >= 3) {
                    filterObj[filter[0]] = filter[2];
                }
            });
            frappe.set_route('List', stat.doctype, filterObj);
        });
    }
}

function update_dashboard_item_count(item, count) {
    item.removeClass('loading');
    item.find('.number').html(count);

    const index = parseInt(item.attr('data-stat-index'));
    const stats_config = get_full_stat_config();
    const stat = stats_config[index];

    item.off('click').on('click', function() {
        const filterObj = {};
        stat.filters.forEach(filter => {
            if (filter.length >= 3) {
                if (filter[1] === 'between' && Array.isArray(filter[2])) {
                    filterObj[filter[0]] = ['between', filter[2]];
                } else {
                    filterObj[filter[0]] = [filter[1], filter[2]];
                }
            }
        });
        frappe.set_route('List', stat.doctype, filterObj);
    });
}

function update_dashboard_item_error(item) {
    item.removeClass('loading warning info').addClass('danger has-error');
    item.find('.number').html(__('Error'));
    item.find('.iqama-stat-icon').html(frappe.utils.icon('triangle-alert', 'sm'));
}

function get_full_stat_config() {
    const today = frappe.datetime.get_today();
    const get_date = frappe.datetime.add_days;

    return [
        {
            label: __('Expired Iqamas'),
            doctype: 'Employee',
            filters: [
                ['iqama_expired', '=', 1],
                ['status', '=', 'Active'],
            ],
            icon: 'circle-alert',
            type: 'danger'
        },
        {
            label: __('Expiration Tomorrow'),
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['iqama_expiration_date', '=', get_date(today, 1)],
                ['status', '!=', 'Renewed']
            ],
            icon: 'clock',
            type: 'danger'
        },
        {
            label: __('Expiration This Week'),
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['iqama_expiration_date', 'between', [today, get_date(today, 7)]],
                ['status', '!=', 'Renewed']
            ],
            icon: 'calendar-clock',
            type: 'warning'
        },
        {
            label: __('Expiration Next Week'),
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['iqama_expiration_date', 'between', [get_date(today, 7), get_date(today, 14)]],
                ['status', '!=', 'Renewed']
            ],
            icon: 'calendar-range',
            type: 'info'
        },
        {
            label: __('Awaiting Operations Approval'),
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['status', '=', 'Awaiting Operations Approval']
            ],
            icon: 'user-check',
            type: 'info'
        }
    ];
}

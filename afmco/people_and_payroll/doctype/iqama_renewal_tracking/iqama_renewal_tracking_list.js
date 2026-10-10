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
                    'options': [
                        {'label': __('Yes'), 'value': 'Yes'},
                        {'label': __('No'), 'value': 'No'}
                    ],
                    'reqd': 1
                },
                {
                    'fieldname': 'renewal_duration',
                    'fieldtype': 'Select',
                    'label': __('Renewal Duration'),
                    'options': [
                        {'label': __('3 months'), 'value': '3 months'},
                        {'label': __('6 months'), 'value': '6 months'},
                        {'label': __('9 months'), 'value': '9 months'},
                        {'label': __('1 year'), 'value': '1 year'}
                    ],
                    'depends_on': 'eval:doc.renewal_preference == "Yes"',
                    'reqd': 0
                },
                {
                    'fieldname': 'reason_of_not_renew',
                    'fieldtype': 'Small Text',
                    'label': __('Reason of Not Renewal'),
                    'depends_on': 'eval:doc.renewal_preference == "No"',
                    'reqd': 0
                }
            ],
            async function(values) {
                if (values.renewal_preference === 'Yes' && !values.renewal_duration) {
                    frappe.msgprint(__('Renewal Duration is required when Renewal Preference is Yes.'));
                    return;
                }
                if (values.renewal_preference === 'No' && !values.reason_of_not_renew) {
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
                                case '9 months':
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
                            paymentRequest.date = frappe.datetime.nowdate();
                            paymentRequest.bank_payment_date = frappe.datetime.nowdate();
                            paymentRequest.payment_type = 'SADAD Payment';
                            paymentRequest.mode_of_payment = 'SADAD Payment';
                            paymentRequest.remark = remarks;
                            paymentRequest.account_no = 'SADAD numbers attached';
                            paymentRequest.payment_approver = 'Human Resources - الموارد البشرية';  //new
        
                            try {
                                // Redirect to the new Expense Request form
                                //frappe.set_route('Form', paymentRequest.doctype, paymentRequest.name);
                                paymentRequest = await frappe.db.insert(paymentRequest); // new

                                await frappe.model.set_value(paymentRequest.doctype, paymentRequest.name, 'account_no', paymentRequest.account_no);
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
                                    setTimeout(() => {
                                        frappe.set_route('Form', paymentRequest.doctype, paymentRequest.name);
                                    }, 800); //new
                                     // new
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

function ensure_dashboard_style_loaded() {
    if ($('#custom-dashboard-style').length === 0) {
        $('<style id="custom-dashboard-style">').html(`
            .list-dashboard {
                display: flex;
                gap: 16px;
                margin-bottom: 20px;
                flex-wrap: wrap;
                padding: 20px;
                background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
                border-radius: var(--border-radius-lg);
                box-shadow: inset 0 1px 3px rgba(0,0,0,0.06);
            }
            
            .dashboard-item {
                flex: 1;
                background: white;
                padding: 20px;
                border-radius: var(--border-radius-md);
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                min-width: 180px;
                border-top: 4px solid transparent;
                text-align: center;
                cursor: pointer;
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                position: relative;
                overflow: hidden;
            }
            
            .dashboard-item::before {
                content: '';
                position: absolute;
                top: 0;
                left: 0;
                right: 0;
                height: 4px;
                background: linear-gradient(90deg, var(--primary) 0%, var(--primary-dark) 100%);
                transform: scaleX(0);
                transform-origin: left;
                transition: transform 0.3s ease;
            }
            
            .dashboard-item:hover::before {
                transform: scaleX(1);
            }
            
            .dashboard-item:hover {
                transform: translateY(-4px);
                box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                background: linear-gradient(135deg, white 0%, var(--gray-50) 100%);
            }
            
            .dashboard-item .icon-wrapper {
                width: 48px;
                height: 48px;
                margin: 0 auto 12px;
                background: var(--gray-100);
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                transition: all 0.3s ease;
            }
            
            .dashboard-item:hover .icon-wrapper {
                background: var(--primary-100);
                transform: scale(1.1);
            }
            
            .dashboard-item .icon-wrapper i {
                font-size: 24px;
                color: var(--gray-600);
                transition: color 0.3s ease;
            }
            
            .dashboard-item:hover .icon-wrapper i {
                color: var(--primary);
            }
            
            .dashboard-item .title {
                font-size: var(--text-sm);
                color: var(--text-muted);
                margin-bottom: 8px;
                font-weight: 500;
                letter-spacing: 0.3px;
                transition: color 0.3s ease;
            }
            
            .dashboard-item:hover .title {
                color: var(--primary-dark);
            }
            
            .dashboard-item .count {
                font-size: 28px;
                font-weight: 700;
                color: var(--gray-900);
                transition: all 0.3s ease;
                display: flex;
                align-items: baseline;
                justify-content: center;
                gap: 4px;
            }
            
            .dashboard-item:hover .count {
                color: var(--primary);
                transform: scale(1.05);
            }
            
            .dashboard-item .count-suffix {
                font-size: var(--text-md);
                font-weight: 400;
                color: var(--text-muted);
            }
            
            .dashboard-item.danger {
                border-top-color: var(--danger);
            }
            
            .dashboard-item.danger::before {
                background: linear-gradient(90deg, var(--danger) 0%, #c82333 100%);
            }
            
            .dashboard-item.danger:hover .icon-wrapper {
                background: rgba(220, 53, 69, 0.1);
            }
            
            .dashboard-item.danger:hover .icon-wrapper i,
            .dashboard-item.danger:hover .count {
                color: var(--danger);
            }
            
            .dashboard-item.warning {
                border-top-color: var(--warning);
            }
            
            .dashboard-item.warning::before {
                background: linear-gradient(90deg, var(--warning) 0%, #e0a800 100%);
            }
            
            .dashboard-item.warning:hover .icon-wrapper {
                background: rgba(255, 193, 7, 0.1);
            }
            
            .dashboard-item.warning:hover .icon-wrapper i,
            .dashboard-item.warning:hover .count {
                color: var(--warning);
            }
            
            .dashboard-item.info {
                border-top-color: var(--info);
            }
            
            .dashboard-item.info::before {
                background: linear-gradient(90deg, var(--info) 0%, #117a8b 100%);
            }
            
            .dashboard-item.info:hover .icon-wrapper {
                background: rgba(23, 162, 184, 0.1);
            }
            
            .dashboard-item.info:hover .icon-wrapper i,
            .dashboard-item.info:hover .count {
                color: var(--info);
            }
            
            .dashboard-item.loading {
                pointer-events: none;
                opacity: 0.6;
            }
            
            .dashboard-item.loading .count {
                color: var(--gray-400);
            }
            
            @media (max-width: 768px) {
                .list-dashboard {
                    gap: 12px;
                    padding: 16px;
                }
                
                .dashboard-item {
                    min-width: calc(50% - 6px);
                    padding: 16px;
                }
                
                .dashboard-item .icon-wrapper {
                    width: 40px;
                    height: 40px;
                    margin-bottom: 8px;
                }
                
                .dashboard-item .icon-wrapper i {
                    font-size: 20px;
                }
                
                .dashboard-item .count {
                    font-size: 24px;
                }
            }
        `).appendTo('head');
    }
}

async function add_dashboard(listview) {
    ensure_dashboard_style_loaded();

    if (!listview.dashboard_area) {
        listview.dashboard_area = $('<div class="list-dashboard"></div>')
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
        const item = listview.dashboard_area.find(`.dashboard-item:eq(${index})`);
        
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
    const displayCount = isLoading ? '...' : count;
    
    const item = $(`
        <div class="dashboard-item ${stat.type} ${isLoading ? 'loading' : ''}" 
             title="${__('Click to view list for')} ${__(stat.label)}"
             data-stat-index="${listview.dashboard_area.children().length}">
            <div class="icon-wrapper">
                <i class="fa ${stat.icon}"></i>
            </div>
            <div class="title ellipsis">${__(stat.label)}</div>
            <div class="count">
                ${displayCount}
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
    item.find('.count').html(count);
    
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
    item.removeClass('loading').addClass('danger');
    item.find('.count').html('<i class="fa fa-exclamation-triangle"></i> Error');
    item.find('.icon-wrapper i').removeClass().addClass('fa fa-exclamation-triangle');
}

function get_full_stat_config() {
    const today = frappe.datetime.get_today();
    const get_date = frappe.datetime.add_days;
    
    return [
        {
            label: 'Expired Iqamas',
            doctype: 'Employee',
            filters: [
                ['iqama_expired', '=', 1],
                ['status', '=', 'Active'],
            ],
            icon: 'fa-exclamation-circle',
            type: 'danger'
        },
        {
            label: 'Expiration Tomorrow',
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['iqama_expiration_date', '=', get_date(today, 1)],
                ['status', '!=', 'Renewed']
            ],
            icon: 'fa-clock',
            type: 'danger'
        },
        {
            label: 'Expiration This Week',
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['iqama_expiration_date', 'between', [today, get_date(today, 7)]],
                ['status', '!=', 'Renewed']
            ],
            icon: 'fa-calendar-week',
            type: 'warning'
        },
        {
            label: 'Expiration Next Week',
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['iqama_expiration_date', 'between', [get_date(today, 7), get_date(today, 14)]],
                ['status', '!=', 'Renewed']
            ],
            icon: 'fa-calendar-alt',
            type: 'info'
        },
        {
            label: 'Awaiting Operations Approval',
            doctype: 'Iqama Renewal Tracking',
            filters: [
                ['status', '=', 'Awaiting Operations Approval']
            ],
            icon: 'fa-user-check',
            type: 'info'
        }
    ];
}
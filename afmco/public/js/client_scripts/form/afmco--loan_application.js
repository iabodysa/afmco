frappe.ui.form.on('Loan Application', {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1 && frm.doc.status === 'Approved') { 
            frm.add_custom_button(__('Payment Request'), () => {
                frappe.call({
                    method: 'frappe.client.get_value',
                    args: {
                        doctype: 'Employee',
                        filters: { name: frm.doc.applicant },
                        fieldname: ['bank_ac_no', 'payroll_cost_center']
                    },
                    callback: function(r) {
                        if (r.message) {
                            const bank_account_no = r.message.bank_ac_no;
                            const employee_cost_center = r.message.cost_center;

                            const paymentRequest = frappe.model.get_new_doc('Payment Requisition');
                            paymentRequest.tax_invoice_number = frm.doc.name;
                            paymentRequest.account_no = bank_account_no; 
                            paymentRequest.beneficiary_name = `${frm.doc.applicant_name} | ${frm.doc.applicant}`;
                            paymentRequest.amount = frm.doc.loan_amount;
                            paymentRequest.cost_center = employee_cost_center; 
                            paymentRequest.project = employee_cost_center;  
                            paymentRequest.jv_status = 'JV Not Created';
                            paymentRequest.naming_series = 'PR-.YYYY.-';
                            paymentRequest.date = frappe.datetime.nowdate();
                            paymentRequest.bank_payment_date = frappe.datetime.nowdate();
                            paymentRequest.payment_type = 'Employee Loan';
                            paymentRequest.mode_of_payment = 'Bank Transfer';
                            paymentRequest.payment_approver = 'Payroll and Compliance - الرواتب والالتزام';
                            paymentRequest.created_by = frappe.session.user;
                            paymentRequest.remark = `
Loan Request Details:
-------------------------------------
- Loan Product: ${frm.doc.loan_product}
- Monthly Repayment Amount: ${frm.doc.repayment_amount || 'Not specified'}
- Repayment Period in Months: ${frm.doc.repayment_periods || 'Not specified'}
- Reason: ${frm.doc.description || 'Not specified'}
`;

                            frappe.set_route('Form', paymentRequest.doctype, paymentRequest.name);
                            frappe.msgprint('A new Payment Request has been created.');
                        } else {
                            frappe.msgprint(__('Failed to retrieve the bank account number and cost center for the applicant.'));
                        }
                    },
                    error: function(err) {
                        frappe.msgprint(__('An error occurred while creating the Payment Request. Please try again.'));
                        console.error(err);
                    }
                });
            }, __('Create'));
        }
    }
});

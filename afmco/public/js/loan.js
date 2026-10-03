frappe.ui.form.on('Loan', {
    before_save: function(frm) {
        if (frm.doc.loan_amount && frm.doc.no_of_depreciation && frm.doc.available_for_use_date) {
            let total_amount = frm.doc.loan_amount;
            let num_of_installments = frm.doc.no_of_depreciation;
            let installment_amount = total_amount / num_of_installments;
            let start_date = frm.doc.available_for_use_date;
            let remaining_balance = total_amount;
            frm.clear_table('repayment_details');
            for (let i = 0; i < num_of_installments; i++) {
                let due_date = frappe.datetime.add_months(start_date, i);
                let payment_amount = Math.min(installment_amount, remaining_balance);
                let row = frm.add_child('repayment_details', {
                    'payment_date': due_date,
                    'principal_amount': payment_amount,
                    'balance_loan_amount': remaining_balance - payment_amount
                });
                remaining_balance -= payment_amount;
            }
            frm.refresh_field('repayment_details');
        }
    }
});
frappe.ui.form.on('Loan', {
    before_submit: function(frm) {
        frm.doc.repayment_details.forEach(function(schedule) {
            frappe.call({
                method: "frappe.client.insert",
                args: {
                    doc: {
                        doctype: "Loan Repayment",
                        applicant_type:"Employee",
                        employee: frm.doc.employee,
                        // salary_component: "Loan Repayment", 
                        amount: schedule.principal_amount,
                        amount_paid: schedule.principal_amount, 
                        posting_date:schedule.payment_date,
                        payroll_date: schedule.payment_date, 
                        company: frm.doc.company,
                        against_loan: frm.doc.name, 
                        remark: `Loan Repayment for ${frm.doc.name}`
                    }
                },
                callback: function(response) {
                    if (response && !response.exc) {
                        frappe.msgprint({
                            title: __('Notification'),
                            message: __('Loan Repayment created for {0} on {1}', [frm.doc.employee, schedule.payment_date]),
                            indicator: 'green'
                        });
                    }
                }
            });
        });
    }
});

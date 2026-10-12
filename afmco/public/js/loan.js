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

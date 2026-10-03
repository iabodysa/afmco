frappe.ui.form.on('Salary Slip', {
    refresh: function(frm) {
        if (frm.doc.employee) {
            frappe.call({
                method: 'frappe.client.get_list',
                args: {
                    doctype: 'Loan Repayment',
                    filters: {
                        applicant: frm.doc.employee,
                        // status: 'Disbursed',  
                        docstatus: 1         
                    },
                    fields: ['name','amount','loan_account']
                },
                callback: function(r) {
                    if (r.message && r.message.length > 0) {
                        let loan = r.message[0];  
                        
                     
                        frm.set_value('custom_loans', loan.name);  
                        frm.set_value('custom_loans_amount', loan.amount);  
                        frm.set_value('custom_loan_account', loan.loan_account);  

                        frm.refresh_field('custom_loans');
                        frm.refresh_field('custom_loans_amount');
                        frm.refresh_field('custom_loan_account');
                    }
                }
            });
        }
    }
});

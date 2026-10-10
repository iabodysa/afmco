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
                        
                     
                        frm.set_value('loans', loan.name);  
                        frm.set_value('loans_amount', loan.amount);  
                        frm.set_value('loan_account', loan.loan_account);  

                        frm.refresh_field('loans');
                        frm.refresh_field('loans_amount');
                        frm.refresh_field('loan_account');
                    }
                }
            });
        }
    }
});

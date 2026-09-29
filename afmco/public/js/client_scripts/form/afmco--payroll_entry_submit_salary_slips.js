frappe.ui.form.on('Payroll Entry', {
    refresh: function(frm) {
        if (frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Submit Salary Slips'), function() {
                submit_salary_slips_and_create_journal_entry(frm);
            });
        }
    }
});

async function submit_salary_slips_and_create_journal_entry(frm) {
    try {
        const salary_slips = await fetch_all_salary_slips(frm);
        
        if (salary_slips.length === 0) {
            frappe.msgprint(__('No draft Salary Slips found for this Payroll Entry.'));
            return;
        }

        frappe.show_alert({ message: `Submitting ${salary_slips.length} Salary Slips...`, indicator: 'orange' });

        for (let slip of salary_slips) {
            try {
                const slip_data = await frappe.call({
                    method: 'frappe.client.get',
                    args: {
                        doctype: 'Salary Slip',
                        name: slip.name
                    }
                });

            
                await frappe.call({
                    method: 'frappe.client.submit',
                    args: {
                        doc: slip_data.message
                    }
                });

                console.log(`Salary Slip ${slip.name} submitted successfully.`);
            } catch (error) {
                console.error(`Failed to submit Salary Slip: ${slip.name}`, error);
                frappe.msgprint(__('Failed to submit Salary Slip: ' + slip.name + '. Error: ' + error.message));
            }
        }

        await create_employee_wise_journal_entry(frm, salary_slips);
    } catch (error) {
        frappe.msgprint(__('An error occurred: ' + error.message));
        console.error('Error during submission:', error);
    }
}

async function fetch_all_salary_slips(frm) {
    let salary_slips = [];
    let offset = 0;
    const page_size = 100;

    while (true) {
        const salary_slips_response = await frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Salary Slip',
                fields: ['name'],
                filters: {
                    'payroll_entry': frm.doc.name,
                    'docstatus': 0 
                },
                limit_page_length: page_size,
                limit_start: offset
            }
        });

        if (salary_slips_response.message.length === 0) {
            break; 
        }

        salary_slips = salary_slips.concat(salary_slips_response.message);
        offset += page_size; 
    }

    return salary_slips;
}

async function create_employee_wise_journal_entry(frm, salary_slips) {
    try {
        frappe.show_alert({ message: `Creating Journal Entry for ${salary_slips.length} Salary Slips...`, indicator: 'orange' });

        const journal_entry = {
            doctype: 'Journal Entry',
            voucher_type: 'Payroll Entry',
            payroll_entry: frm.doc.name,
            company: frm.doc.company || 'Default Company',
            posting_date: frm.doc.posting_date || frappe.datetime.now_date(),
            accounts: []
        };

        let total_credit = 0;
        let total_debit = 0;

        for (let slip of salary_slips) {
            const salary_slip_doc = await frappe.call({
                method: 'frappe.client.get',
                args: {
                    doctype: 'Salary Slip',
                    name: slip.name
                }
            });

            if (!salary_slip_doc.message) {
                frappe.msgprint(__('Failed to fetch Salary Slip: ' + slip.name));
                continue;
            }

            const salary_slip_data = salary_slip_doc.message;
            let employee_credit = 0;
            let employee_debit = 0;

          
            salary_slip_data.earnings.forEach(earning => {
                if (earning.account && earning.amount) {
                    journal_entry.accounts.push({
                        account: earning.account,
                        debit_in_account_currency: earning.amount || 0,
                        cost_center: salary_slip_data.cost_center || 'Default Cost Center',
                        user_remark: salary_slip_data.remark || 'No remark',
                        employee: salary_slip_data.employee || 'Unknown Employee'
                    });
                    total_credit += earning.amount;
                    employee_credit += earning.amount;
                }
            });

          
            salary_slip_data.deductions.forEach(deduction => {
                if (deduction.account && deduction.amount) {
                    journal_entry.accounts.push({
                        account: deduction.account,
                        credit_in_account_currency: deduction.amount || 0,
                        user_remark: salary_slip_data.remark || 'No remark',
                        party_type: 'Employee',
                        party: salary_slip_data.employee || 'Unknown Employee'
                    });
                    total_debit += deduction.amount;
                    employee_debit += deduction.amount;
                }
            });

      
            const net_pay = employee_credit - employee_debit;
            if (net_pay > 0) {
                journal_entry.accounts.push({
                    account: frm.doc.payroll_payable_account || 'Default Payable Account',
                    credit_in_account_currency: net_pay,
                    user_remark: salary_slip_data.remark || 'No remark',
                    party_type: 'Employee',
                    party: salary_slip_data.employee || 'Unknown Employee'
                });
                total_debit += net_pay;
            } else if (net_pay < 0) {
                journal_entry.accounts.push({
                    account: frm.doc.payroll_receivable_account || 'Default Receivable Account',
                    user_remark: salary_slip_data.remark || 'No remark',
                    debit_in_account_currency: Math.abs(net_pay),
                    cost_center: salary_slip_data.cost_center || 'Default Cost Center',
                    employee: salary_slip_data.employee || 'Unknown Employee'
                });
                total_credit += Math.abs(net_pay);
            }
        }

        if (total_credit !== total_debit) {
            frappe.msgprint(__('Total Debit must equal Total Credit. The difference is ' + (total_debit - total_credit)));
            return;
        }

      
        const insert_response = await frappe.call({
            method: 'frappe.client.insert',
            args: {
                doc: journal_entry
            }
        });

        if (insert_response.message) {
            frappe.msgprint(__('Employee-wise Journal Entry created for Payroll Entry: ' + frm.doc.name));
        } else {
            frappe.msgprint(__('Failed to create Journal Entry for Payroll Entry: ' + frm.doc.name));
        }
    } catch (error) {
        frappe.msgprint(__('An error occurred while creating the Journal Entry: ' + error.message));
        console.error('Error during Journal Entry creation:', error);
    }
}

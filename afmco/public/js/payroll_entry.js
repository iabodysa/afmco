frappe.ui.form.on('Payroll Entry', {
    setup: function(frm) {
        const core_query = frm.fields_dict.employees.grid.get_field('employee').get_query;
        frm.set_query('employee', 'employees', () => ({
            ...core_query(),
            query: 'afmco.people_and_payroll.api.payroll_entry.employee_query',
        }));
    },
    add_context_buttons: function(frm) {},
    refresh: function(frm) {
        if (frm.doc.docstatus == 0 && !frm.is_new() && (frm.doc.employees || []).length) {
            frm.add_custom_button(__('Check Employees'), () => showPayrollCheck(frm, true));
        }
        if (frm.doc.docstatus == 1 && frm.doc.salary_slips_created == 1) {
            checkSalarySlipsAndAddButtons(frm);
        }
    },
    after_save: function(frm) {
        if (frm.doc.docstatus == 0 && (frm.doc.employees || []).length) {
            showPayrollCheck(frm, false);
        }
    },
    bank_entry_created: function(frm) {
        if (frm.doc.bank_entry_created) {
            frappe.msgprint(__('You cannot uncheck "Bank Entry Created" once it has been set.'));
            frm.set_value('bank_entry_created', 1);
        }
    }
});

function showPayrollCheck(frm, always) {
    return frm.call('get_payroll_check').then(({ message: check }) => {
        if (!check.blockers.length && !check.held.length && !check.info.length) {
            if (always) {
                frappe.show_alert({ message: __('No issues found'), indicator: 'green' });
            }
            return;
        }
        const dialog = new frappe.ui.Dialog({
            title: __('Payroll Check'),
            size: 'large',
            fields: [{ fieldtype: 'HTML', fieldname: 'body' }],
        });
        dialog.fields_dict.body.$wrapper.html(renderPayrollCheck(check));
        if (check.held.length) {
            dialog.set_primary_action(__('Include in this payroll'), () => {
                const employees = dialog.$wrapper.find('input.afmco-held:checked').map((i, input) => input.value).get();
                if (!employees.length) {
                    return;
                }
                frm.call('include_held_employees', { employees }).then(() => {
                    dialog.hide();
                    frm.dirty();
                    frm.save();
                });
            });
        }
        dialog.show();
    });
}

function renderPayrollCheck(check) {
    const escape = frappe.utils.escape_html;
    const employeeCell = (row) => row.employee
        ? `<a href="${frappe.utils.get_form_link('Employee', row.employee)}" target="_blank">${escape(row.employee)}</a> ${escape(row.employee_name || '')}`
        : '';
    const issueTable = (rows) => `<table class="table table-bordered table-sm"><tbody>${rows.map((row) =>
        `<tr><td>${employeeCell(row)}</td><td>${escape(row.reason)}</td></tr>`).join('')}</tbody></table>`;
    const sections = [];
    if (check.blockers.length) {
        sections.push(`<h5 class="text-danger">${__('Must be fixed before submitting')}</h5>${issueTable(check.blockers)}`);
    }
    if (check.held.length) {
        const rows = check.held.map((row) => `<tr>
            <td><input type="checkbox" class="afmco-held" value="${escape(row.employee)}" checked></td>
            <td>${employeeCell(row)}</td>
            <td>${escape(row.department || '')}</td>
            <td>${escape(row.last_salary_month || __('Never paid'))}</td></tr>`).join('');
        sections.push(`<h5>${__('On Hold for no salary in the last 3 months')}</h5>
            <p class="text-muted">${__('Included employees return to Active when their salary slip is submitted.')}</p>
            <table class="table table-bordered table-sm"><thead><tr><th></th><th>${__('Employee')}</th>
            <th>${__('Department')}</th><th>${__('Last paid month')}</th></tr></thead><tbody>${rows}</tbody></table>`);
    }
    if (check.info.length) {
        sections.push(`<h5 class="text-muted">${__('For your information')}</h5>${issueTable(check.info)}`);
    }
    return sections.join('');
}

async function checkSalarySlipsAndAddButtons(frm) {
    try {
        const salarySlips = await getSalarySlips(frm.doc.name);
        if (!salarySlips || salarySlips.length === 0) {
            return;
        }

        const journalEntries = await getExistingJournalEntries(frm.doc.name);
        
        const hasAccrual = journalEntries.some(entry => entry.voucher_type === 'Payroll Entry');
        const hasBank = journalEntries.some(entry => entry.voucher_type === 'Bank Entry');

        if (!hasAccrual) {
            frm.add_custom_button(__('Make Accrual Entry'), () => makeAccrualEntry(frm));
        }

        if (!hasBank) {
            frm.add_custom_button(__('Make Bank Entry'), () => makeBankEntry(frm));
        }
    } catch (error) {
        frappe.msgprint(__('An error occurred while checking salary slips or adding buttons. Please check console for details.'));
    }
}

async function getSalarySlips(payrollEntry) {
    try {
        const response = await frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Salary Slip',
                filters: { payroll_entry: payrollEntry, docstatus: 1 },
                fields: ['name', 'employee', 'net_pay'],
                limit_page_length: 0
            }
        });
        return response.message || [];
    } catch (error) {
        throw error;
    }
}

async function getExistingJournalEntries(payrollEntry) {
    try {
        const response = await frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Journal Entry',
                filters: { payroll_entry: payrollEntry },
                fields: ['name', 'voucher_type'],
                limit_page_length: 0
            }
        });
        return response.message || [];
    } catch (error) {
        throw error;
    }
}

function makeAccrualEntry(frm) {
    frappe.model.open_mapped_doc({
        method: 'afmco.people_and_payroll.api.payroll_entry.make_accrual_entry',
        frm: frm
    });
}

async function makeBankEntry(frm) {
    if (!frm.doc.payroll_payable_account || !frm.doc.payment_account) {
        frappe.msgprint(__('Please set both Payroll Payable Account and Payment Account.'));
        return;
    }

    try {
        const salarySlips = await getSalarySlipsForPayment(frm.doc.name);
        
        if (!salarySlips.length) {
            frappe.msgprint(__('No Salary Slips found for payment.'));
            return;
        }

        const { message: defaults } = await frappe.call({
            method: 'afmco.people_and_payroll.api.payroll_entry.get_bank_fee_defaults',
            args: { payroll_entry: frm.doc.name }
        });

        const dialog = new frappe.ui.Dialog({
            title: __('Bank Entry Settings'),
            fields: [
                {
                    label: __('Apply Bank Transfer Fees'),
                    fieldname: 'apply_fees',
                    fieldtype: 'Check',
                    default: defaults.apply_fees,
                    onchange: function() {
                        const apply = dialog.get_value('apply_fees');
                        dialog.fields_dict.fees_per_transfer.toggle(apply);
                        dialog.fields_dict.total_fees.toggle(apply);
                        dialog.fields_dict.vat_amount.toggle(apply);
                        dialog.fields_dict.bank_fees_account.toggle(apply);
                        dialog.fields_dict.vat_account.toggle(apply);
                        
                        if (apply) {
                            calculateTotals();
                        }
                    }
                },
                {
                    label: __('Fees per Transfer'),
                    fieldname: 'fees_per_transfer',
                    fieldtype: 'Currency',
                    default: defaults.fees_per_transfer,
                    hidden: !defaults.apply_fees,
                    onchange: function() {
                        calculateTotals();
                    }
                },
                {
                    label: __('Number of Employees'),
                    fieldname: 'employee_count',
                    fieldtype: 'Int',
                    read_only: 0,
                    default: defaults.employee_count,
                    onchange: function() {
                        calculateTotals();
                    }
                },
                {
                    label: __('Total Fees'),
                    fieldname: 'total_fees',
                    fieldtype: 'Currency',
                    read_only: 0,
                    hidden: !defaults.apply_fees
                },
                {
                    label: __('VAT Amount (15%)'),
                    fieldname: 'vat_amount',
                    fieldtype: 'Currency',
                    read_only: 0,
                    hidden: !defaults.apply_fees
                },
                {
                    label: __('Bank Fees Account'),
                    fieldname: 'bank_fees_account',
                    fieldtype: 'Link',
                    options: 'Account',
                    hidden: !defaults.apply_fees,
                    reqd: 1,
                    default: defaults.bank_fees_account,
                    get_query: function() {
                        return {
                            filters: {
                                company: frm.doc.company,
                                account_type: ['in', ['Expense Account', 'Cost of Goods Sold']],
                                is_group: 0
                            }
                        };
                    }
                },
                {
                    label: __('VAT Account'),
                    fieldname: 'vat_account',
                    fieldtype: 'Link',
                    options: 'Account',
                    hidden: !defaults.apply_fees,
                    reqd: 1,
                    default: defaults.vat_account,
                    get_query: function() {
                        return {
                            filters: {
                                company: frm.doc.company,
                                account_type: 'Tax',
                                is_group: 0
                            }
                        };
                    }
                }
            ],
            primary_action_label: __('Create Bank Entry'),
            primary_action: function(values) {
                if (values.apply_fees && (!values.bank_fees_account || !values.vat_account)) {
                    frappe.msgprint(__('Please select Bank Fees Account and VAT Account if applying fees.'));
                    return;
                }

                dialog.hide();
                frappe.model.open_mapped_doc({
                    method: 'afmco.people_and_payroll.api.payroll_entry.make_bank_entry',
                    frm: frm,
                    args: values
                });
            }
        });

        function calculateTotals() {
            const feesPerTransfer = dialog.get_value('fees_per_transfer') || 0;
            const empCount = dialog.get_value('employee_count') || 0;
            const totalFees = feesPerTransfer * empCount;
            const vatAmount = totalFees * 0.15;
            
            dialog.set_value('total_fees', totalFees);
            dialog.set_value('vat_amount', vatAmount);
        }

        dialog.show();
        if (defaults.apply_fees) {
            calculateTotals();
        }

    } catch (error) {
        frappe.msgprint(__('Error displaying Bank Entry settings: ') + error.message);
    }
}

async function getSalarySlipsForPayment(payrollEntry) {
    try {
        const response = await frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Salary Slip',
                filters: { payroll_entry: payrollEntry, docstatus: 1 },
                fields: ['name', 'employee', 'employee_name', 'net_pay', 'cost_center', 'remark'],
                limit_page_length: 0
            }
        });
        return response.message || [];
    } catch (error) {
        throw error;
    }
}

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

        const insert_response = await frappe.call({
            method: 'afmco.people_and_payroll.api.payroll_entry.make_employee_wise_journal_entry',
            args: {
                payroll_entry: frm.doc.name,
                salary_slips: salary_slips.map(slip => slip.name)
            }
        });

        if (insert_response.message) {
            frappe.msgprint(__('Employee-wise Journal Entry created for Payroll Entry: ' + frm.doc.name));
        }
    } catch (error) {
        frappe.msgprint(__('An error occurred while creating the Journal Entry: ' + error.message));
        console.error('Error during Journal Entry creation:', error);
    }
}

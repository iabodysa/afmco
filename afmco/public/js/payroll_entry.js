frappe.ui.form.on('Payroll Entry', {
    setup: function(frm) {
        const core_query = frm.fields_dict.employees.grid.get_field('employee').get_query;
        frm.set_query('employee', 'employees', () => ({
            ...core_query(),
            query: 'afmco.people_and_payroll.api.payroll_entry.employee_query',
        }));
    },
    add_context_buttons: function(frm) {},
    onload: function(frm) {
        frm.errorList = [];
    },
    refresh: function(frm) {
        if (!frm.doc.previous_results) {
            frm.add_custom_button(__('Verify Data', null, 'Payroll Entry'), function() {
                executeAllVerifications(frm);
            }).addClass('btn-danger');
        }

        if (frm.doc.previous_results) {
            frm.add_custom_button(__('View Previous Results', null, 'Payroll Entry'), function() {
                showPreviousResults(frm);
            }).addClass('btn-info');
        }
        // new 2025
        if (frm.doc.docstatus == 1 && frm.doc.salary_slips_created == 1) {
            checkSalarySlipsAndAddButtons(frm);
        }

        
    },
    bank_entry_created: function(frm) {
        if (frm.doc.bank_entry_created) {
            frappe.msgprint(__('You cannot uncheck "Bank Entry Created" once it has been set.'));
            frm.set_value('bank_entry_created', 1);
        }
    } // new 2025
});
async function executeAllVerifications(frm) {
    frm.errorList = []; // Reinitialize the error list at the start of verification
    const verifications = [
        { function: checkSalaryStructureAndConflicts, progress_label: __('Checking Salary Structure and Conflicts', null, 'Payroll Entry') },
        { function: checkExistingSalarySlips, progress_label: __('Checking Existing Salary Slips', null, 'Payroll Entry') },
        { function: checkEmployeeInfo, progress_label: __('Verifying Employee Information', null, 'Payroll Entry') },
        { function: checkEmployeeHolidays, progress_label: __('Checking Employee Holidays', null, 'Payroll Entry') },
        { function: checkCostCenterMatch, progress_label: __('Checking Cost Center Match', null, 'Payroll Entry') },
    ];

    const employees = frm.doc.employees || [];
    let allWarnings = new Set();
    let progressDetails = [];
    let totalSteps = employees.length * verifications.length;
    let currentStep = 0;

    for (let v = 0; v < verifications.length; v++) {
        let warnings = [];
        let progress_message = verifications[v].progress_label;

        for (let i = 0; i < employees.length; i++) {
            const employee = employees[i];
            try {
                const result = await verifications[v].function(frm, employee, frm.doc.start_date, frm.doc.end_date);
                if (result) {
                    allWarnings.add(result);
                }
            } catch (error) {
                const errorDetails = {
                    employee: employee.employee,
                    error: error.message,
                    functionName: verifications[v].function.name,
                    doctype: frm.doc.doctype,
                    timestamp: frappe.datetime.now_datetime()
                };
                frm.errorList.push(errorDetails);
                allWarnings.add(getLocalizedErrorMessage('Error for employee', employee, error.message));
            }
            currentStep++;
            let progress_percent = (currentStep / totalSteps) * 100;
            let current_employee_message = `${__('Please wait', null, 'Payroll Entry')} - ${__('Executing procedure', null, 'Payroll Entry')} ${progress_message} (${v + 1} ${__('out of', null, 'Payroll Entry')} ${verifications.length}), ${__('Checking employee', null, 'Payroll Entry')} (${i + 1} ${__('out of', null, 'Payroll Entry')} ${employees.length})`;

            frappe.show_progress(
                __('Verification in Progress', null, 'Payroll Entry'),
                progress_percent,
                100,
                current_employee_message
                );
        }
    }

    // Hide the progress bar after all verifications are complete
    frappe.hide_progress(); 

    frm.doc.previous_results = allWarnings.size === 0 ? __('No issues found.', null, 'Payroll Entry') : Array.from(allWarnings).map(warning => `<li>${warning}</li>`).join('');
    await logErrors(frm, frm.errorList);

    frm.remove_custom_button(__('Verify Data', null, 'Payroll Entry'));
    if (frm.doc.previous_results) {
        frm.add_custom_button(__('View Previous Results', null, 'Payroll Entry'), function() {
            showPreviousResults(frm);
        }).addClass('btn-info');
    }
    if (allWarnings.size === 0) {
        frappe.show_alert({
            message: __('Successfully completed verification with no issues.', null, 'Payroll Entry'),
            indicator: 'green'
        });
    } else {
        frappe.msgprint({
            title: __('Verification completed with warnings', null, 'Payroll Entry'),
            message: `<div style="padding: 10px; border: 1px solid #d9534f; background-color: #f2dede; color: #a94442; border-radius: 5px;">
                        <strong>${__('The following warnings were found:', null, 'Payroll Entry')}</strong>
                        <ul style="margin-top: 10px;">${frm.doc.previous_results}</ul>
                      </div>`,
            indicator: 'red'
        });
    }
}
async function checkSalaryStructureAndConflicts(frm, employee, start_date, end_date) {
    try {
        // Collect data in a single call using appropriate filters for each employee
        const [salaryStructureAssignments, additionalSalaries] = await Promise.all([
            getFrappeData(
                "Salary Structure Assignment",
                ["name", "from_date", "salary_structure"],
                { employee: employee.employee, docstatus: 1, from_date: ["<=", start_date] }
            ),
            getFrappeData(
                "Additional Salary",
                ["name", "salary_component", "overwrite_salary_structure_amount"],
                { employee: employee.employee, payroll_date: ["between", [start_date, end_date]], docstatus: 1 }
            )
        ]);

        if (salaryStructureAssignments.length === 0) {
            return getLocalizedErrorMessage('No valid salary structure assignment', employee, start_date);
        }

        const salaryStructure = salaryStructureAssignments[0].salary_structure;

        // Use caching to avoid repetitive queries
        if (!frm.salaryStructureCache) {
            frm.salaryStructureCache = {};
        }

        let salaryStructureDoc;
        if (frm.salaryStructureCache[salaryStructure]) {
            salaryStructureDoc = frm.salaryStructureCache[salaryStructure];
        } else {
            salaryStructureDoc = await getFrappeDataByName("Salary Structure", salaryStructure);
            frm.salaryStructureCache[salaryStructure] = salaryStructureDoc;
        }

        const earnings = salaryStructureDoc.earnings;
        const salaryComponents = earnings.map(item => item.salary_component);

        // Check for conflicts
        const conflicts = additionalSalaries.filter(item =>
            item.overwrite_salary_structure_amount && !salaryComponents.includes(item.salary_component)
        );

        if (conflicts.length > 0) {
            let conflictLinks = conflicts.map(item => `<a href="${frappe.utils.get_form_link("Additional Salary", item.name)}" target="_blank">${item.salary_component}</a>`).join(', ');
            return getLocalizedConflictMessage(employee, start_date, end_date, conflictLinks);
        }

        return null;
    } catch (error) {
        collectError(frm.errorList, employee.employee, error, 'checkSalaryStructureAndConflicts', frm.doctype);
        throw error;
    }
}
function getLocalizedConflictMessage(employee, startDate, endDate, conflictLinks) {
    const employeeLink = `<a href="${frappe.utils.get_form_link("Employee", employee.employee)}" target="_blank">${employee.employee_name}</a>`;
    return __('Salary conflicts found {0} between {1} and {2}: {3}.', [employeeLink, startDate, endDate, conflictLinks], 'Payroll Entry');
}
function getLocalizedErrorMessage(message, employee, details = '') {
    const employeeLink = `<a href="${frappe.utils.get_form_link("Employee", employee.employee)}" target="_blank">${employee.employee}</a>`;
    const args = [employeeLink, details, employee.employee_name, details[0], details[1]];
    switch (message) {
        case 'No valid salary structure assignment':
            return __('No valid salary structure assignment {0} {1}', args, 'Payroll Entry');
        case 'Error for employee':
            return __('Error for employee {0} {1}', args, 'Payroll Entry');
        case 'Existing salary slip found':
            return __('Existing salary slip found {0} {1}', args, 'Payroll Entry');
        case 'Employee is not active':
            return __('Employee is not active {0} {1}', args, 'Payroll Entry');
        case 'Employee joining date is after the payroll start date':
            return __('Employee joining date is after the payroll start date {0} {1}', args, 'Payroll Entry');
        case 'Employee has a relieving date on or before the payroll start date':
            return __('Employee has a relieving date on or before the payroll start date {0} {1}', args, 'Payroll Entry');
        case 'Employee is on leave on the payroll start date':
            return __('Employee is on leave on the payroll start date {0} {1}', args, 'Payroll Entry');
        case 'Cost center mismatch':
            return __('Cost center mismatch {0} {1}', args, 'Payroll Entry');
        default:
            return `${message} ${employeeLink} ${details}`;
    }
}
function showPreviousResults(frm) {
    if (frm.doc.previous_results) {
        frappe.msgprint({
            title: __('Previous Verification Results', null, 'Payroll Entry'),
            indicator: 'blue',
            message: frm.doc.previous_results
        });
    } else {
        frappe.msgprint(__('No previous results found.', null, 'Payroll Entry'));
    }
}
async function checkExistingSalarySlips(frm, employee, start_date, end_date) {
    try {
        const response = await getFrappeData(
            "Salary Slip", 
            ["name", "employee", "employee_name"], 
            { employee: employee.employee, start_date: ["<=", end_date], end_date: [">=", start_date], docstatus: ["<", 2] }
        );

        if (response.length > 0) {
            let slip_name = response[0].name;
            let employee_name = response[0].employee_name;
            let link = `<a href="${frappe.utils.get_form_link("Salary Slip", slip_name)}" target="_blank">${slip_name}</a>`;
            return getLocalizedErrorMessage('Existing salary slip found', employee, link);
        }
        return null;
    } catch (error) {
        collectError(frm.errorList, employee.employee, error, 'checkExistingSalarySlips', frm.doctype);
        throw error;
    }
}
async function getFrappeData(doctype, fields, filters) {
    try {
        const response = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: doctype,
                fields: fields,
                filters: filters
            }
        });
        if (response.message) {
            return response.message;
        } else {
            throw new Error('No data found');
        }
    } catch (error) {
        throw new Error(`Error fetching data from ${doctype}: ${error.message}`);
    }
}
async function getFrappeDataByName(doctype, name) {
    try {
        const response = await frappe.call({
            method: "frappe.client.get",
            args: {
                doctype: doctype,
                name: name
            }
        });
        if (response.message) {
            return response.message;
        } else {
            throw new Error(`No data found for ${name} in ${doctype}`);
        }
    } catch (error) {
        throw new Error(`Error fetching data from ${doctype}: ${error.message}`);
    }
}
function collectError(errorList, employee, error, functionName, docType) {
    errorList.push({
        employee: employee,
        message: error.message,
        stack: error.stack || error.message,
        functionName: functionName,
        docType: docType
    });
}
async function logErrors(frm, errorList) {
    if (!errorList || errorList.length === 0) return;

    const errorMessages = errorList.map(error => 
        `Error occurred in function: ${error.functionName}\nDocument Type: ${error.docType}\nEmployee: ${error.employee}\nError Message: ${error.message}\nStack Trace: ${error.stack}\nTimestamp: ${frappe.datetime.now_datetime()}\n\n`
    ).join('\n\n');

    const fullMessage = `The following errors were encountered during the verification process:\n\n${errorMessages}`;

    await frappe.call({
        method: "afmco.people_and_payroll.api.payroll_entry.log_verification_errors",
        args: {
            payroll_entry: frm.is_new() ? null : frm.doc.name,
            message: fullMessage
        }
    });
}
async function checkEmployeeInfo(frm, employee, start_date) {
    try {
        const response = await getFrappeData(
            "Employee",
            ["status", "date_of_joining", "relieving_date"],
            { name: employee.employee }
        );

        const info = response[0];
        let warnings = [];
        if (info.status !== 'Active') {
            warnings.push(getLocalizedErrorMessage('Employee is not active', employee));
        }
        if (info.date_of_joining > start_date) {
            warnings.push(getLocalizedErrorMessage('Employee joining date is after the payroll start date', employee));
        }
        if (info.relieving_date && info.relieving_date <= start_date) {
            warnings.push(getLocalizedErrorMessage('Employee has a relieving date on or before the payroll start date', employee));
        }
        return warnings.length > 0 ? warnings.join('<br>') : null;
    } catch (error) {
        collectError(frm.errorList, employee.employee, error, 'checkEmployeeInfo', frm.doctype);
        throw error;
    }
}
async function checkEmployeeHolidays(frm, employee, start_date) {
    try {
        const response = await getFrappeData(
            "Leave Application",
            ["name", "from_date", "to_date"],
            { employee: employee.employee, status: "Approved", docstatus: 1, from_date: ["<=", start_date], to_date: [">=", start_date] }
        );

        if (response.length > 0) {
            let holiday = response[0];
            let link = `<a href="${frappe.utils.get_form_link("Leave Application", holiday.name)}" target="_blank">${__('View Leave', null, 'Payroll Entry')}</a>`;
            return getLocalizedErrorMessage('Employee is on leave on the payroll start date', employee, link);
        }
        return null;
    } catch (error) {
        collectError(frm.errorList, employee.employee, error, 'checkEmployeeHolidays', frm.doctype);
        throw error;
    }
}
async function checkCostCenterMatch(frm, employee) {
    try {
        const response = await getFrappeData(
            "Employee",
            ["payroll_cost_center"],
            { name: employee.employee }
        );

        const employeeCostCenter = response[0].payroll_cost_center;
        if (frm.doc.cost_center !== employeeCostCenter) {
            return getLocalizedErrorMessage('Cost center mismatch', employee, [frm.doc.cost_center, employeeCostCenter]);
        }
        return null;
    } catch (error) {
        collectError(frm.errorList, employee.employee, error, 'checkCostCenterMatch', frm.doctype);
        throw error;
    }
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

        const employeeCount = salarySlips.filter(s => s.net_pay > 0).length;
        
        const defaultBankFeesAccountName = '539008 - م - رسوم بنكية - M - Bank fees - AF';
        const defaultVatAccountName = '216003 - VAT 15% - AF';

        const bankFeesAccountExists = await frappe.db.exists('Account', defaultBankFeesAccountName);
        const vatAccountExists = await frappe.db.exists('Account', defaultVatAccountName);

        if (!bankFeesAccountExists) {
            frappe.msgprint(__(`Error: Default Bank Fees Account "${defaultBankFeesAccountName}" does not exist. Please create it or update the script.`));
            return;
        }
        if (!vatAccountExists) {
            frappe.msgprint(__(`Error: Default VAT Account "${defaultVatAccountName}" does not exist. Please create it or update the script.`));
            return;
        }

        const dialog = new frappe.ui.Dialog({
            title: __('Bank Entry Settings'),
            fields: [
                {
                    label: __('Apply Bank Transfer Fees'),
                    fieldname: 'apply_fees',
                    fieldtype: 'Check',
                    default: 0,
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
                    default: 3.5,
                    hidden: 1,
                    onchange: function() {
                        calculateTotals();
                    }
                },
                {
                    label: __('Number of Employees'),
                    fieldname: 'employee_count',
                    fieldtype: 'Int',
                    read_only: 0,
                    default: employeeCount
                },
                {
                    label: __('Total Fees'),
                    fieldname: 'total_fees',
                    fieldtype: 'Currency',
                    read_only: 0,
                    hidden: 1
                },
                {
                    label: __('VAT Amount (15%)'),
                    fieldname: 'vat_amount',
                    fieldtype: 'Currency',
                    read_only: 0,
                    hidden: 1
                },
                {
                    label: __('Bank Fees Account'),
                    fieldname: 'bank_fees_account',
                    fieldtype: 'Link',
                    options: 'Account',
                    hidden: 1,
                    reqd: 1,
                    default: defaultBankFeesAccountName,
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
                    hidden: 1,
                    reqd: 1,
                    default: defaultVatAccountName,
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

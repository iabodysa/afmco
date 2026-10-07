frappe.ui.form.on('Payroll Entry', {
    add_context_buttons: function(frm) {},
    onload: function(frm) {
        if (!frm.doc.previous_results) {
            frappe.model.set_value(frm.doctype, frm.docname, 'previous_results', '');
        }
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

        if (frm.doc.accrual_entry_created) {
            frm.set_df_property('accrual_entry_created', 'read_only', 1);
        } else {
            frm.set_df_property('accrual_entry_created', 'read_only', 0);
        }

        if (frm.doc.bank_entry_created) {
            frm.set_df_property('bank_entry_created', 'read_only', 1);
        } else {
            frm.set_df_property('bank_entry_created', 'read_only', 0);
        } // new 2025
        
    },
// new 2025
    accrual_entry_created: function(frm) {
        if (frm.doc.accrual_entry_created) {
            frappe.msgprint(__('You cannot uncheck "Accrual Entry Created" once it has been set.'));
            frm.set_value('accrual_entry_created', 1);
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

async function get_component_account_mapping(company) {
    const [components, accounts] = await Promise.all([
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Salary Component',
                fields: ['name', 'type'],
                limit_page_length: 0
            }
        }),
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Salary Component Account',
                parent: 'Salary Component',
                filters: { company: company },
                fields: ['parent', 'account'],
                limit_page_length: 0
            }
        })
    ]);

    if (!components.message) {
        throw new Error('Could not fetch salary components: No message in response.');
    }

    const accountByComponent = (accounts.message || []).reduce((acc, row) => {
        acc[row.parent] = row.account;
        return acc;
    }, {});

    return components.message.reduce((acc, comp) => {
        acc[comp.name] = {
            account: accountByComponent[comp.name],
            type: comp.type
        };
        return acc;
    }, {});
}

async function makeAccrualEntry(frm) {
   if (!frm.doc.payroll_payable_account) {
       frappe.msgprint(__('Please set the Payroll Payable Account.'));
       return;
   }

   frappe.show_alert({ message: __('Processing Accrual Entry...'), indicator: 'blue' });

   try {
       const componentMapping = await get_component_account_mapping(frm.doc.company);
       const salarySlips = await getFullSalarySlips(frm.doc.name);

       if (!salarySlips.length) {
           frappe.msgprint(__('No Salary Slips found.'));
           if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
               frappe.hide_alert();
           }
           return;
       }

       const startDate = new Date(frm.doc.start_date);
       const monthName = startDate.toLocaleString('en-US', { month: 'long' });
       const year = startDate.getFullYear();

       const journalEntryName = frappe.model.make_new_doc_and_get_name('Journal Entry');

       frappe.model.set_value('Journal Entry', journalEntryName, {
           voucher_type: 'Payroll Entry',
           posting_date: frm.doc.posting_date,
           company: frm.doc.company,
           payroll_entry: frm.doc.name,
           cheque_no: frm.doc.name,
           cheque_date: frm.doc.posting_date,
           user_remark: `Salary accrual for ${monthName} ${year}\nFrom: ${frm.doc.start_date} to: ${frm.doc.end_date}`
       });

       const accountsData = [];

       for (const slip of salarySlips) {
           const costCenter = slip.cost_center || frm.doc.cost_center;
           if (!costCenter) {
               frappe.msgprint(__(`Cost Center is missing for Salary Slip ${slip.name} and no default Cost Center in Payroll Entry document.`));
               throw new Error(`Missing Cost Center for ${slip.name}`);
           }

           if (slip.earnings) {
               for (const earning of slip.earnings) {
                   const componentInfo = componentMapping[earning.salary_component];
                   if (!componentInfo || !componentInfo.account) {
                       frappe.msgprint(__(`Default account not found for Salary Component: "${earning.salary_component}".`));
                       throw new Error(`Missing account for Salary Component: ${earning.salary_component}`);
                   }

                   accountsData.push({
                       account: componentInfo.account,
                       employee: slip.employee,
                       debit_in_account_currency: earning.amount,
                       cost_center: costCenter,
                       user_remark: slip.remark || '',
                       needs_party: false
                   });
               }
           }

           if (slip.deductions) {
               for (const deduction of slip.deductions) {
                   const componentInfo = componentMapping[deduction.salary_component];
                   if (!componentInfo || !componentInfo.account) {
                       frappe.msgprint(__(`Default account not found for Deduction Component: "${deduction.salary_component}".`));
                       throw new Error(`Missing account for Deduction Component: ${deduction.salary_component}`);
                   }

                   accountsData.push({
                       account: componentInfo.account,
                     //  employee: slip.employee,
                       party_type: 'Employee',
                       party: slip.employee,
                       credit_in_account_currency: deduction.amount,
                   //    cost_center: costCenter,
                       user_remark: slip.remark || '',
                       needs_party: true
                   });
               }
           }

           const netPay = slip.net_pay || 0;
           if (netPay > 0) {
               accountsData.push({
                   account: frm.doc.custom_payroll_clearing_account,
                   party_type: 'Employee',
                   party: slip.employee,
                   credit_in_account_currency: netPay,
                 //  cost_center: costCenter,
                   user_remark: slip.remark || '',
                   needs_party: true
               });
           }
       }

       frappe.set_route('Form', 'Journal Entry', journalEntryName).then(() => {
           return new Promise(resolve => {
               const check = setInterval(() => {
                   if (window.cur_frm && cur_frm.doc.name === journalEntryName && cur_frm.fields_dict.accounts) {
                       clearInterval(check);
                       resolve(cur_frm);
                   }
               }, 1);
           });
       }).then(async (newJournalFrm) => {
           for (const rowData of accountsData) {
               const row = newJournalFrm.add_child('accounts');
               const needs_party = rowData.needs_party;
               delete rowData.needs_party;
               
               await frappe.model.set_value(row.doctype, row.name, {
                   account: rowData.account,
                   debit_in_account_currency: rowData.debit_in_account_currency || 0,
                   credit_in_account_currency: rowData.credit_in_account_currency || 0,
                   cost_center: rowData.cost_center,
                   user_remark: rowData.user_remark
               });
               
               await new Promise(resolve => setTimeout(resolve, 100));
               
               if (needs_party) {
                   await frappe.model.set_value(row.doctype, row.name, {
                       party_type: rowData.party_type,
                       party: rowData.party
                   });
               } else if (rowData.employee) {
                   await frappe.model.set_value(row.doctype, row.name, {
                       employee: rowData.employee
                   });
               }
           }

           newJournalFrm.refresh_field('accounts');

           if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
               frappe.hide_alert();
           }
       }).catch(error => {
           frappe.msgprint(__('Error creating Accrual Entry: ') + error.message);
           if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
               frappe.hide_alert();
           }
       });

   } catch (error) {
       frappe.msgprint(__('Error creating Accrual Entry: ') + error.message);
       if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
           frappe.hide_alert();
       }
   }
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
            primary_action: async function(values) {
                if (values.apply_fees && (!values.bank_fees_account || !values.vat_account)) {
                    frappe.msgprint(__('Please select Bank Fees Account and VAT Account if applying fees.'));
                    return;
                }
                
                dialog.hide();
                frappe.show_alert({ message: __('Creating Journal Entry...'), indicator: 'blue' });
                await createBankJournalEntry(frm, salarySlips, values);
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

async function createBankJournalEntry(frm, salarySlips, settings) {
   try {
       const journalEntryName = frappe.model.make_new_doc_and_get_name('Journal Entry');

       frappe.model.set_value('Journal Entry', journalEntryName, {
           voucher_type: 'Bank Entry',
           posting_date: frm.doc.posting_date,
           company: frm.doc.company,
           payroll_entry: frm.doc.name,
           cheque_no: frm.doc.name, 
           cheque_date: frm.doc.posting_date,
           user_remark: `Salary payment from ${frm.doc.start_date} to ${frm.doc.end_date}`
       });

       frappe.set_route('Form', 'Journal Entry', journalEntryName)
           .then(() => {
               return new Promise(resolve => {
                   const checkFormReady = setInterval(() => {
                       if (window.cur_frm && window.cur_frm.doctype === 'Journal Entry' && window.cur_frm.doc.name === journalEntryName && window.cur_frm.fields_dict && window.cur_frm.fields_dict.accounts) {
                           clearInterval(checkFormReady);
                           resolve(window.cur_frm);
                       }
                   }, 100); 
               });
           })
           .then(async (newJournalFrm) => {
               const accountsData = [];
               let totalPayment = 0;

               if (!frm.doc.payroll_payable_account) {
                   frappe.msgprint('Payroll Payable Account is required in Payroll Entry document to create Bank Entry.');
                   throw new Error('Payroll Payable Account is required in Payroll Entry document to create Bank Entry.');
               }
               
               for (const slip of salarySlips) {
                   if (slip.net_pay > 0) {
                       const costCenter = slip.cost_center || frm.doc.cost_center;
                       if (!costCenter) {
                           frappe.msgprint(`Cost Center is missing for Salary Slip ${slip.name} or Payroll Entry default for Bank Entry.`);
                           throw new Error(`Cost Center is missing for Salary Slip ${slip.name} or Payroll Entry default for Bank Entry.`);
                       }

                       accountsData.push({
                           account: frm.doc.custom_payroll_clearing_account,
                           party_type: 'Employee',
                           party: slip.employee,
                           debit_in_account_currency: slip.net_pay,
                           cost_center: costCenter,
                           user_remark: slip.remark || '',
                           needs_party: true
                       });
                       totalPayment += slip.net_pay;
                   }
               }

               if (totalPayment > 0) {
                   if (!frm.doc.payment_account) {
                       frappe.msgprint('Payment Account is required in Payroll Entry document to create Bank Entry.');
                       throw new Error('Payment Account is required in Payroll Entry document to create Bank Entry.');
                   }
                   
                   accountsData.push({
                       account: frm.doc.payment_account,
                       bank_account: frm.doc.bank_account || null,
                       credit_in_account_currency: totalPayment,
                       cost_center: frm.doc.cost_center,
                       user_remark: frm.doc.user_remark || `${frm.doc.cost_center} - ${frm.doc.month_name || ''}`,
                       needs_party: false
                   });

                   if (settings.apply_fees && settings.total_fees > 0) {
                       if (!settings.bank_fees_account || !settings.vat_account) {
                           frappe.msgprint('Bank Fees Account or VAT Account from dialog settings is missing.');
                           throw new Error('Bank Fees Account or VAT Account from dialog settings is missing.');
                       }

                       accountsData.push({
                           account: settings.bank_fees_account,
                           debit_in_account_currency: settings.total_fees,
                           cost_center: frm.doc.cost_center || 'الادارة رئيسي - Head Office - AF',
                           user_remark: 'Bank transfer fees',
                           needs_party: false
                       });

                       accountsData.push({
                           account: settings.vat_account,
                           debit_in_account_currency: settings.vat_amount,
                           user_remark: 'VAT for bank transfer fees',
                           needs_party: false
                       });

                       accountsData.push({
                           account: frm.doc.payment_account,
                           credit_in_account_currency: settings.total_fees,
                           user_remark: 'Bank transfer fees',
                           needs_party: false
                       });

                       accountsData.push({
                           account: frm.doc.payment_account,
                           credit_in_account_currency: settings.vat_amount,
                           user_remark: 'VAT for bank transfer fees',
                           needs_party: false
                       });
                   }
               }

               for (const rowData of accountsData) {
                   const row = newJournalFrm.add_child('accounts');
                   const needs_party = rowData.needs_party;
                   delete rowData.needs_party;
                   
                   const basic_data = {
                       account: rowData.account,
                       debit_in_account_currency: rowData.debit_in_account_currency || 0,
                       credit_in_account_currency: rowData.credit_in_account_currency || 0,
                       cost_center: rowData.cost_center,
                       user_remark: rowData.user_remark
                   };
                   
                   if (rowData.bank_account) {
                       basic_data.bank_account = rowData.bank_account;
                   }
                   
                   await frappe.model.set_value(row.doctype, row.name, basic_data);
                   
                   await new Promise(resolve => setTimeout(resolve, 100));
                   
                   if (needs_party) {
                       await frappe.model.set_value(row.doctype, row.name, {
                           party_type: rowData.party_type,
                           party: rowData.party
                       });
                   }
               }
               
               newJournalFrm.refresh_field('accounts');

               if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
                   frappe.hide_alert();
               }
           })
           .catch(error => {
               frappe.msgprint(__('Error creating Bank Journal Entry: ') + error.message);
               if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
                   frappe.hide_alert();
               }
           });
           
   } catch (error) {
       frappe.msgprint(__('Error creating Bank Journal Entry: ') + error.message);
       
       if (frappe.hide_alert && typeof frappe.hide_alert === 'function') {
           frappe.hide_alert();
       }
   }
}

async function getFullSalarySlips(payrollEntry) {
    const slips = await getSalarySlips(payrollEntry);
    const promises = slips.map(slip => frappe.db.get_doc('Salary Slip', slip.name));
    try {
        const fullSlips = await Promise.all(promises);
        return fullSlips;
    } catch (error) {
        throw error;
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

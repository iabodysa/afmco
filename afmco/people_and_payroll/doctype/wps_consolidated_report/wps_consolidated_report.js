frappe.ui.form.on('WPS Consolidated Report', {
    refresh: function(frm) {
        frm.add_custom_button(__('Configure Payroll Entries'), () => {
            show_filter_dialog(frm); 
            
        }, __('Actions')).addClass('btn-primary');
        frm.add_custom_button(__('Generate Pre-Check Report'), () => {
            generatePreCheckReport(frm); 
            
        }, __('Actions')).addClass('btn-info'); 
        
     // Buttons for submitted documents if (frm.doc.docstatus === 1) { if (frm.doc.generated_zip_file) { frm.add_custom_button(__('Download ZIP'), () => { window.open(frm.doc.generated_zip_file, '_blank'); }, __('Actions')).addClass('btn-success'); } if (frm.doc.cmd_script) { frm.add_custom_button(__('Copy BAT Script'), () => { copy_to_clipboard(frm.doc.cmd_script, 'BAT script'); }, __('Actions')); }
        if (frappe.user.has_role('System Manager') && frm.doc.docstatus === 1) {
            frm.add_custom_button(__('Unlink Payroll Entries'), function() {
                frappe.confirm(
                    __('Are you sure you want to unlink all Payroll Entry records from this report?'),
                    function() {
                        frm.call({ doc: frm.doc, method: 'release_payroll_entries', freeze: true, freeze_message: __('Unlinking Payroll Entries...') }).then((r) => {
                            if (r.message && r.message.total) {
                                frappe.msgprint(__('Unlinked {0} out of {1} Payroll Entries.', [r.message.released, r.message.total]));
                            }
                            frm.reload_doc();
                        });
                    }
                );
            });
        }

        // Buttons for submitted documents
        if (frm.doc.docstatus === 1 && Array.isArray(frm.doc.attached_reports) && frm.doc.attached_reports.length) {
            frm.add_custom_button(__('Copy Email Body'), () => {
                generateEmailBody(frm);
            }).addClass('btn-primary');
        }
        


        // Lock key fields after submission
        if (frm.doc.docstatus === 1) {
            ['payroll_entries', 'bank_format', 'file_type']
                .forEach(f => frm.set_df_property(f, 'read_only', 1));
        }
    },
    
    onload: function(frm) {
        if (frm.is_new()) {
            frm.set_value({
                status: 'Draft',
                bank_format: 'NCBK',
                file_type: 'CSV'
            });
        }
    
        const table_field = frm.fields_dict["payroll_entries"];
        if (table_field && table_field.grid) {
            table_field.grid.get_field("payroll_entry").get_query = function(doc, cdt, cdn) {
                try {
                    const query = {
                        filters: {
                            docstatus: 1,
                            custom_wps_report_reference: ["is", "not set"],
                            creation: [">=", frappe.datetime.add_months(frappe.datetime.nowdate(), -3)]
                        }
                    };
                    return query;
                } catch (e) {
                    frappe.msgprint(__('Error in get_query: ') + e.message);
                    console.error("get_query error", e);
                }
            };
        }
    },

    before_submit(frm) {
        return new Promise(resolve => {
            frappe.confirm(
                __('This will generate WPS files and cannot be undone. Continue?'),
                () => resolve(),
                () => resolve(false)
            );
        });
    },
    
    on_trash(frm) {
        // Clear linked references before deletion
        if (frm.doc.payroll_entries && frm.doc.payroll_entries.length) {
            // This will be handled by the Python on_trash method
            // No client-side action needed
        }
    },

    payroll_entries_on_form_rendered(frm) {
        // Update child table validation
        if (frm.doc.payroll_entries && frm.doc.payroll_entries.length > 10) {
            frappe.msgprint(__('Warning: processing more than 10 Payroll Entries may take longer'));
        }
    },

    title(frm) {
        if (!frm.doc.title && frm.doc.payroll_entries && frm.doc.payroll_entries.length) {
            const cnt = frm.doc.payroll_entries.length;
            const ts = frappe.datetime.nowdate();
            frm.set_value('title', `WPS Report - ${cnt} Entries - ${ts}`);
        }
    }
});
async function generatePreCheckReport(frm) {
    if (!frm.doc.payroll_entries || frm.doc.payroll_entries.length === 0) {
        frappe.msgprint(__('Please select at least one Payroll Entry before running pre-check.'));
        return;
    }

    // Show progress bar
    frappe.show_progress(__('Pre-Check Validation'), 0, 100, __('Starting validation...'));

    try {
        // Step 1: Fetch payroll entries (20%)
        frappe.show_progress(__('Pre-Check Validation'), 20, 100, __('Fetching payroll entries...'));
        const payrollEntries = await fetchPayrollEntriesForPreCheck(frm);
        
        // Step 2: Fetch salary slips (40%)
        frappe.show_progress(__('Pre-Check Validation'), 40, 100, __('Fetching salary slips...'));
        const salarySlips = await fetchSalarySlipsForPreCheck(payrollEntries);
        
        // Step 3: Build virtual WPS metadata (60%)
        frappe.show_progress(__('Pre-Check Validation'), 60, 100, __('Building virtual WPS metadata...'));
        const virtualMetadata = await buildVirtualWPSMetadata(salarySlips);
        
        // Step 4: Validate and resolve CR numbers (80%)
        frappe.show_progress(__('Pre-Check Validation'), 80, 100, __('Resolving commercial registration numbers...'));
        await resolveCommercialRegistrations(virtualMetadata);
        
        // Step 5: Generate summary (100%)
        frappe.show_progress(__('Pre-Check Validation'), 100, 100, __('Generating summary...'));
        const summary = generatePreCheckSummary(virtualMetadata);
        
        // Hide progress and show results
        frappe.hide_progress();
        
        // Save summary to field if it exists
        if (frm.fields_dict.pre_check_report) {
            frm.set_value('pre_check_report', summary.html);
        }
        
        // Show modal dialog
        showPreCheckDialog(summary);
        
    } catch (error) {
        frappe.hide_progress();
        frappe.msgprint({
            title: __('Pre-Check Failed'),
            message: __('Error during pre-check validation: {0}', [error.message]),
            indicator: 'red'
        });
        console.error('Pre-check error:', error);
    }
}
async function fetchPayrollEntriesForPreCheck(frm) {
    const entryNames = frm.doc.payroll_entries.map(row => row.payroll_entry).filter(Boolean);
    
    if (entryNames.length === 0) {
        throw new Error('No valid payroll entries found');
    }
    
    return new Promise((resolve, reject) => {
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Payroll Entry',
                filters: [['name', 'in', entryNames], ['docstatus', '=', 1]],
                fields: ['name', 'company', 'start_date', 'end_date', 'payroll_frequency', 'cost_center']
            },
            callback: function(r) {
                if (r.message) {
                    resolve(r.message);
                } else {
                    reject(new Error('Failed to fetch payroll entries'));
                }
            },
            error: function(err) {
                reject(err);
            }
        });
    });
}
async function fetchSalarySlipsForPreCheck(payrollEntries) {
    const entryNames = payrollEntries.map(pe => pe.name);
    
    // Create a map of payroll entry to cost center
    const costCenterMap = {};
    payrollEntries.forEach(pe => {
        costCenterMap[pe.name] = pe.cost_center || '';
    });
    
    return new Promise((resolve, reject) => {
        frappe.call({
            method: 'frappe.client.get_list',
            args: {
                doctype: 'Salary Slip',
                filters: [
                    ['payroll_entry', 'in', entryNames],
                    ['docstatus', '=', 1]
                ],
                fields: [
                    'name', 'employee', 'employee_name', 'company', 'payroll_entry',
                    'net_pay', 'custom_hold', 'labor_office_file_number',
                    'bank_name', 'bank_account_no', 'start_date', 'end_date',
                    'basic33', 'housing33', 'other_allowance33', 'deduction33'
                ],
                limit_page_length: 10000
            },
            callback: function(r) {
                if (r.message) {
                    // Add cost center to each slip based on its payroll entry
                    r.message.forEach(slip => {
                        slip.cost_center = costCenterMap[slip.payroll_entry] || '';
                    });
                    resolve(r.message);
                } else {
                    reject(new Error('Failed to fetch salary slips'));
                }
            },
            error: function(err) {
                reject(err);
            }
        });
    });
}
async function buildVirtualWPSMetadata(salarySlips) {
    // Group by labor office file number matching Python logic
    const grouped = {};
    const holdEmployees = [];
    
    salarySlips.forEach(slip => {
        const molNo = slip.labor_office_file_number;
        const isHold = slip.custom_hold === 1;
        
        if (isHold) {
            holdEmployees.push({
                employee: slip.employee,
                employee_name: slip.employee_name,
                net_pay: slip.net_pay || 0,
                labor_office_file_number: molNo
            });
            return; // Skip hold employees from regular processing
        }
        
        // Filter out zero-pay slips matching Python logic
        if (!slip.net_pay || slip.net_pay <= 0) {
            return;
        }
        
        const key = molNo || "NO_LABOR_OFFICE";
        
        if (!grouped[key]) {
            grouped[key] = {
                labor_office_file_number: molNo,
                corporation: '',
                corporation_cr: '',
                employees_count: 0,
                total_net_pay: 0,
                employees: [],
                is_hold_file: false,
                has_issues: false,
                issues: [],
                cost_center: slip.cost_center || '' // Store for project name extraction
            };
        }
        
        grouped[key].employees.push(slip);
        grouped[key].employees_count++;
        grouped[key].total_net_pay += slip.net_pay || 0;
        // Keep the cost center from the first slip
        if (!grouped[key].cost_center && slip.cost_center) {
            grouped[key].cost_center = slip.cost_center;
        }
    });
    
    // Add hold file if there are hold employees (matching Python logic)
    if (holdEmployees.length > 0) {
        grouped['WPS_HOLD_FILE'] = {
            labor_office_file_number: 'WPS_HOLD_FILE',
            corporation: '',
            corporation_cr: '',
            employees_count: holdEmployees.length,
            total_net_pay: holdEmployees.reduce((sum, emp) => sum + emp.net_pay, 0),
            employees: holdEmployees,
            is_hold_file: true,
            has_issues: false,
            issues: []
        };
    }
    
    // Resolve corporations for each MOL number
    const uniqueMolNumbers = Object.keys(grouped).filter(key => 
        key !== 'WPS_HOLD_FILE' && key !== 'NO_LABOR_OFFICE'
    );
    
    if (uniqueMolNumbers.length > 0) {
        try {
            const corpData = await new Promise((resolve, reject) => {
                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'Corporation',
                        filters: [['establishment_number', 'in', uniqueMolNumbers]],
                        fields: ['name', 'cr', 'establishment_number'],
                        limit_page_length: 1000
                    },
                    callback: function(r) {
                        if (r.message) {
                            resolve(r.message);
                        } else {
                            resolve([]);
                        }
                    },
                    error: function(err) {
                        console.error('Error fetching corporations:', err);
                        resolve([]);
                    }
                });
            });
            
            // Map corporations by establishment number
            const corpMap = {};
            corpData.forEach(corp => {
                if (corp.establishment_number) {
                    corpMap[corp.establishment_number] = corp;
                }
            });
            
            // Assign corporations to groups
            uniqueMolNumbers.forEach(molNo => {
                if (corpMap[molNo]) {
                    grouped[molNo].corporation = corpMap[molNo].name;
                }
            });
        } catch (e) {
            console.error('Failed to fetch corporation data:', e);
        }
    }
    
    return Object.values(grouped);
}
async function resolveCommercialRegistrations(virtualMetadata) {
    // Get all unique corporations (excluding hold file)
    const uniqueCorps = [...new Set(
        virtualMetadata
            .filter(r => !r.is_hold_file && r.corporation)
            .map(r => r.corporation)
    )];
    
    const crCache = {};
    
    if (uniqueCorps.length > 0) {
        try {
            // Single IN query as required
            const corpData = await new Promise((resolve, reject) => {
                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'Corporation',
                        filters: [['name', 'in', uniqueCorps]],
                        fields: ['name', 'cr', 'establishment_number'],
                        limit_page_length: 1000
                    },
                    callback: function(r) {
                        if (r.message) {
                            resolve(r.message);
                        } else {
                            resolve([]);
                        }
                    },
                    error: function(err) {
                        console.error('Error fetching corporations:', err);
                        resolve([]);
                    }
                });
            });
            
            // Cache corporation data
            corpData.forEach(corp => {
                crCache[corp.name] = corp;
            });
        } catch (e) {
            console.error('Failed to fetch corporation data:', e);
        }
    }
    
    // Assign CR numbers and check for issues
    virtualMetadata.forEach(row => {
        // Skip if already has CR or is hold file
        if (row.corporation_cr || row.is_hold_file) {
            return;
        }
        
        // Try to resolve CR from corporation
        if (row.corporation && crCache[row.corporation]) {
            const corp = crCache[row.corporation];
            row.corporation_cr = corp.cr || '';
        }
        
        // Check for missing data
        if (!row.is_hold_file) {
            if (!row.labor_office_file_number || row.labor_office_file_number === 'NO_LABOR_OFFICE') {
                row.has_issues = true;
                row.issues.push('Missing MOL Number');
            }
            if (!row.corporation_cr) {
                row.has_issues = true;
                row.issues.push('Missing Commercial Registration');
            }
        }
    });
}
function generatePreCheckSummary(virtualMetadata) {
    const regularFiles = virtualMetadata.filter(r => !r.is_hold_file);
    const holdFiles = virtualMetadata.filter(r => r.is_hold_file);
    const issueFiles = virtualMetadata.filter(r => r.has_issues);
    
    const totalFiles = regularFiles.length;
    const totalEmployees = regularFiles.reduce((sum, r) => sum + r.employees_count, 0);
    const totalNetPay = regularFiles.reduce((sum, r) => sum + r.total_net_pay, 0);
    const holdEmployees = holdFiles.reduce((sum, r) => sum + r.employees_count, 0);
    const holdNetPay = holdFiles.reduce((sum, r) => sum + r.total_net_pay, 0);
    
    const fmt = new Intl.NumberFormat('en-SA', { style:'currency', currency:'SAR', minimumFractionDigits:2 });
    const mol = x => x ? `1 - ${x}` : 'N/A';
    
    const hasIssues = issueFiles.length > 0;
    const statusColor = hasIssues ? '#dc3545' : '#28a745';
    const statusText = hasIssues ? 'Issues Found' : 'Validation Passed';
    
    // Word-style HTML table formatting as required
    let html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#2c3e50;max-width:820px;margin:0 auto;padding:20px;">
  <div style="text-align:center;margin-bottom:20px;">
    <h3 style="color:${statusColor};margin:0;">${statusText}</h3>
    <p style="margin:5px 0;color:#666;">Pre-Check Validation Report</p>
  </div>
  
  <table style="width:100%;border-collapse:collapse;margin-bottom:20px;"><tbody>
    <tr style="height:15pt">
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>MOL No.</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>CR</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>Count</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>Total Amount</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>Status</b></td>
    </tr>`;
    
    // Regular files
    regularFiles.forEach(r => {
        const statusIcon = r.has_issues ? '❌' : '✅';
        const rowColor = r.has_issues ? '#ffebee' : '';
        html += `
    <tr style="height:15pt;background:${rowColor};">
      <td nowrap style="border-bottom:1pt solid #8ea9db;padding:0 5.4pt;text-align:center;"><b>${mol(r.labor_office_file_number)}</b></td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${r.corporation_cr || '—'}</td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${r.employees_count}</td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${fmt.format(r.total_net_pay)}</td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${statusIcon}</td>
    </tr>`;
    });
    
    // Grand total
    html += `
    <tr style="height:15pt">
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>Grand Total</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>${totalFiles}</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>${totalEmployees}</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>${fmt.format(totalNetPay)}</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>—</b></td>
    </tr>
  </tbody></table>`;
    
    // Hold employees section
    if (holdFiles.length > 0) {
        html += `
  <div style="margin:20px 0;padding:15px;background:#fff3cd;border:1px solid #ffeaa7;border-radius:4px;">
    <h4 style="margin:0 0 10px;color:#856404;">Hold Employees (${holdEmployees} employees)</h4>
    <p style="margin:0;font-size:13px;color:#856404;">Total Amount: ${fmt.format(holdNetPay)}</p>
    <p style="margin:5px 0 0;font-size:12px;color:#856404;">These employees will be exported to a separate "WPS Hold File".</p>
  </div>`;
    }
    
    // Issues section
    if (hasIssues) {
        html += `
  <div style="margin:20px 0;padding:15px;background:#ffebee;border:1px solid #f44336;border-radius:4px;">
    <h4 style="margin:0 0 10px;color:#d32f2f;">Issues Found</h4>
    <ul style="margin:0;padding-left:20px;color:#d32f2f;">`;
        
        issueFiles.forEach(r => {
            if (r.issues && r.issues.length > 0) {
                html += `
      <li><b>${mol(r.labor_office_file_number)}</b>: ${r.issues.join(', ')}</li>`;
            }
        });
        
        html += `
    </ul>
    <p style="margin:10px 0 0;font-size:12px;color:#d32f2f;">Please resolve these issues before submitting the report.</p>
  </div>`;
    }
    
    html += `
  <div style="text-align:center;margin-top:20px;">
    <p style="font-size:12px;color:#666;">Generated on: ${frappe.datetime.now_datetime()}</p>
  </div>
</div>`;
    
    return {
        html: html,
        hasIssues: hasIssues,
        totalFiles: totalFiles,
        totalEmployees: totalEmployees,
        totalNetPay: totalNetPay,
        holdEmployees: holdEmployees,
        holdNetPay: holdNetPay,
        issues: issueFiles
    };
}
function showPreCheckDialog(summary) {
    const dialog = new frappe.ui.Dialog({
        title: summary.hasIssues ? __('Pre-Check: Issues Found') : __('Pre-Check: Validation Passed'),
        size: 'large',
        fields: [
            {
                fieldname: 'summary_html',
                fieldtype: 'HTML',
                options: summary.html
            }
        ],
        primary_action_label: summary.hasIssues ? __('Close') : __('Proceed to Submit'),
        primary_action: function() {
            dialog.hide();
            if (!summary.hasIssues) {
                frappe.show_alert({
                    message: __('Pre-check passed! You can now submit the report.'),
                    indicator: 'green'
                });
            }
        }
    });
    
    dialog.show();
}
async function generateEmailBody(frm) {
    if (!frm.doc.attached_reports || frm.doc.attached_reports.length === 0) {
        frappe.msgprint(__('No WPS files found. Please generate WPS ZIP first.'));
        return;
    }

    // Separate regular files from hold files
    const regularFiles = frm.doc.attached_reports.filter(row => !row.is_hold_file);
    const holdFiles = frm.doc.attached_reports.filter(row => row.is_hold_file);

    // Enhanced CR resolution using the same logic as Python code
    await enhancedCRResolution(regularFiles);

    const fmt = new Intl.NumberFormat('en-SA', { style:'currency', currency:'SAR', minimumFractionDigits:2 });
    const mol = x => x ? `1 - ${x}` : 'N/A';
    
    // Calculate totals for regular files only (excluding hold files)
    const totalFiles = regularFiles.length;
    const totalEmployees = regularFiles.reduce((sum, row) => sum + (row.employees_count || 0), 0);
    const totalNetPay = regularFiles.reduce((sum, row) => sum + (row.total_net_pay || 0), 0);
    
    // Determine download button label based on single-file logic (matching Python logic)
    let downloadButtonLabel = "Download WPS Files Package";
    if (frm.doc.attached_reports.length === 1 && frm.doc.generated_zip_file && !frm.doc.generated_zip_file.endsWith('.zip')) {
        downloadButtonLabel = "Download Payroll File";
    }

    // Generate public download URL - convert /private to /files
    const baseUrl = frappe.urllib.get_base_url();
    let publicDownloadUrl = '';
    let fullDownloadUrl = '';
    
    if (frm.doc.generated_zip_file) {
        publicDownloadUrl = frm.doc.generated_zip_file.replace('/private/files/', '/files/');
        fullDownloadUrl = `${baseUrl}${publicDownloadUrl}`;
    }

    // Get title/PR number and bank name for the email
    const prNumber = frm.doc.title || `WPS Report ${frm.doc.name}`;
    const bankName = frm.doc.bank_format || 'Bank';

    let html = `
<div style="font-family:Arial,sans-serif;font-size:14px;color:#2c3e50;max-width:820px;margin:0 auto;">
  <p><b>Dear ${bankName} Representative,</b></p>
  <p>Please find attached the WPS files for payroll processing (${prNumber}). Below is a summary of the files:</p>
  
  <table style="width:100%;border-collapse:collapse;margin:20px 0;"><tbody>
    <tr style="height:15pt">
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>MOL No.</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>CR</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>Count</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>Total Amount</b></td>
      <td nowrap style="border-bottom:1pt solid #8ea9db;background:#d9e1f2;padding:0 5.4pt;height:15pt;text-align:center;"><b>File Name</b></td>
    </tr>`;
    
    // Regular files table rows with proper file naming matching Python logic
    regularFiles.forEach(row => {
        // Generate the expected filename based on naming convention
        const fileName = row.file_name || generateExpectedFileName(row, frm);
        
        html += `
    <tr style="height:15pt">
      <td nowrap style="border-bottom:1pt solid #8ea9db;padding:0 5.4pt;text-align:center;"><b>${mol(row.labor_office_file_number)}</b></td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${row.corporation_cr || '—'}</td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${row.employees_count || 0}</td>
      <td nowrap style="padding:0 5.4pt;text-align:center;">${fmt.format(row.total_net_pay || 0)}</td>
      <td nowrap style="padding:0 5.4pt;text-align:center;font-size:11px;">${fileName}</td>
    </tr>`;
    });
    
    // Grand total row
    html += `
    <tr style="height:15pt">
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>Grand Total</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>${totalFiles}</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>${totalEmployees}</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>${fmt.format(totalNetPay)}</b></td>
      <td nowrap style="background:#d9e1f2;padding:0 5.4pt;text-align:center;"><b>—</b></td>
    </tr>
  </tbody></table>`;
    
    // Hold files information (only when present)
    if (holdFiles.length > 0) {
        const holdEmployees = holdFiles.reduce((sum, row) => sum + (row.employees_count || 0), 0);
        const holdNetPay = holdFiles.reduce((sum, row) => sum + (row.total_net_pay || 0), 0);
        
        html += `
  <div style="margin:20px 0;padding:15px;background:#fff3cd;border-left:4px solid #ffc107;">
    <p style="margin:0;font-weight:bold;color:#856404;">Hold Information:</p>
    <p style="margin:5px 0;color:#856404;">${holdEmployees} employees (${fmt.format(holdNetPay)}) are on hold and exported separately as "WPS Hold File".</p>
  </div>`;
    }
    
    // Add download link if available
    if (fullDownloadUrl) {
        html += `
  <p><b>Download Link:</b> <a href="${fullDownloadUrl}" target="_blank">${downloadButtonLabel}</a></p>`;
    }
    
    html += `
  <p><b>Important:</b> Please double-check the totals before uploading to the bank system.</p>
  
  <div style="margin:20px 0;padding:15px;background:#e3f2fd;border-left:4px solid #2196f3;">
    <p style="margin:0;font-weight:bold;color:#1565c0;">IBAN Update Links:</p>
    <p style="margin:5px 0;color:#1565c0;">
      • Internal: <a href="https://afmco.sa/desk/iban-update/" target="_blank">https://afmco.sa/desk/iban-update/</a><br>
      • External: <a href="https://afmco.sa/iban-update" target="_blank">https://afmco.sa/iban-update</a>
    </p>
    <p style="margin:5px 0 0;font-size:12px;color:#1565c0;">For any bank account updates, please use the links above.</p>
  </div>
  
  <p>Best regards,<br><b>WPS Payroll Unit</b></p>
</div>`;

    // Copy to clipboard and show success message
    copyHtmlToClipboard(html, __('Email body copied to clipboard!'));
}
async function enhancedCRResolution(regularFiles) {
    // Get unique corporations for bulk fetch
    const uniqueCorps = [...new Set(regularFiles.map(row => row.corporation).filter(Boolean))];
    const crCache = {};
    
    if (uniqueCorps.length > 0) {
        try {
            // Single IN query as required
            const corpData = await new Promise((resolve, reject) => {
                frappe.call({
                    method: 'frappe.client.get_list',
                    args: {
                        doctype: 'Corporation',
                        filters: [['name', 'in', uniqueCorps]],
                        fields: ['name', 'cr', 'establishment_number'],
                        limit_page_length: 1000
                    },
                    callback: function(r) {
                        if (r.message) {
                            resolve(r.message);
                        } else {
                            resolve([]);
                        }
                    },
                    error: function(err) {
                        console.error('Error fetching corporations:', err);
                        resolve([]);
                    }
                });
            });
            
            // Cache corporation data
            corpData.forEach(corp => {
                crCache[corp.name] = corp;
            });
        } catch (e) {
            console.error('Failed to fetch corporation data:', e);
        }
    }

    // Apply CR resolution logic matching Python code
    regularFiles.forEach(row => {
        if (row.corporation_cr) {
            // Already has CR, skip
            return;
        }
        
        if (row.corporation && crCache[row.corporation]) {
            const corp = crCache[row.corporation];
            // Use establishment_number match if available
            if (row.labor_office_file_number && corp.establishment_number === row.labor_office_file_number) {
                row.corporation_cr = corp.cr || '';
            } else {
                row.corporation_cr = corp.cr || '';
            }
        }
    });
}
function generateExpectedFileName(row, frm) {
    if (row.is_hold_file) {
        // Format: WPS_Hold_File_YYMMDD.csv
        const today = new Date();
        const yy = today.getFullYear().toString().slice(-2);
        const mm = (today.getMonth() + 1).toString().padStart(2, '0');
        const dd = today.getDate().toString().padStart(2, '0');
        return `WPS_Hold_File_${yy}${mm}${dd}.csv`;
    }
    
    // Use file_name if already populated by Python
    if (row.file_name) {
        return row.file_name;
    }
    
    // Otherwise generate the expected name
    // Format: <MOL_No> <CR> <EmployeeCount> <TotalAmount> <HundredsColumn> <ProjectName> <MonAbbr> <YY>.csv
    const molNo = row.labor_office_file_number || 'NO_LABOR_OFFICE';
    const cr = row.corporation_cr || '';
    const count = row.employees_count || 0;
    const totalAmount = row.total_net_pay || 0;
    const halalas = Math.round((totalAmount % 1) * 100).toString().padStart(2, '0');
    
    // Extract project name from cost center if available
    let projectName = 'Project';
    if (row.cost_center) {
        projectName = extractProjectNameFromCostCenter(row.cost_center);
    }
    
    const today = new Date();
    const monthAbbr = today.toLocaleDateString('en-US', { month: 'short' }).toUpperCase();
    const yearTwoDigit = today.getFullYear().toString().slice(-2);
    
    return `${molNo} ${cr} ${count} ${totalAmount.toFixed(2)} ${halalas} ${projectName} ${monthAbbr} ${yearTwoDigit}.csv`;
}
function extractProjectNameFromCostCenter(costCenter) {
    if (!costCenter) return 'Project';
    
    // Format: "Barns Alzaini - Labours - بارنز الزيني - عمال - AF"
    // Extract first English segment before the first Arabic character
    const parts = costCenter.split(' - ');
    if (parts.length > 0) {
        // Take the first part (English project name)
        let projectName = parts[0].trim();
        
        // Remove any trailing company codes (usually 2 letters at the end)
        if (parts.length > 1) {
            const lastPart = parts[parts.length - 1].trim();
            if (lastPart.length === 2 && /^[A-Z]{2}$/.test(lastPart)) {
                // Don't use the company code
            }
        }
        
        return projectName;
    }
    
    return 'Project';
}
function show_filter_dialog(frm) {
    const today = frappe.datetime.get_today();
    const month_start = frappe.datetime.month_start(today);
    const month_end = frappe.datetime.month_end(today);

    const dialog = new frappe.ui.Dialog({
        title: __('Payroll Entry Filters'),
        fields: [
            {
                fieldname: 'department',
                label: 'Department',
                fieldtype: 'Link',
                options: 'Department'
            },
            {
                fieldname: 'cost_center',
                label: 'Cost Center',
                fieldtype: 'Link',
                options: 'Cost Center'
            },
            {
                fieldname: 'period_start',
                label: 'Period Start',
                fieldtype: 'Date',
                default: month_start
            },
            {
                fieldname: 'period_end',
                label: 'Period End',
                fieldtype: 'Date',
                default: month_end
            }
        ],
        primary_action_label: __('Search and Populate'),
        primary_action(values) {
            fetch_approved_payroll_entries(frm, values);
            dialog.hide();
        }
    });
    dialog.show();
}
function fetch_approved_payroll_entries(frm, values) {
    let filters = {
        docstatus: 1,
        custom_wps_report_reference: ['is', 'not set']
    };

    if (values.department) {
        filters.department = values.department;
    }

    if (values.cost_center) {
        filters.cost_center = values.cost_center;
    }

    if (values.period_start) {
        filters.start_date = ['>=', values.period_start];
    }

    if (values.period_end) {
        filters.end_date = ['<=', values.period_end];
    }

    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Payroll Entry',
            filters: filters,
            fields: ['name'],
            limit_page_length: 1000
        },
        callback: function(res) {
            if (!res.message || res.message.length === 0) {
                frappe.msgprint(__('No Payroll Entries match your criteria.'));
                return;
            }

            frm.clear_table('payroll_entries');
            res.message.forEach(pe => {
                frm.add_child('payroll_entries', {
                    payroll_entry: pe.name
                });
            });

            frm.set_df_property('payroll_entries', 'hidden', 0);
            frm.refresh_field('payroll_entries');
            
            frappe.show_alert({
                message: __('Added {0} Payroll Entries', [res.message.length]),
                indicator: 'green'
            });
        },
        error: function(err) {
            frappe.msgprint(__('Error occurred while fetching Payroll Entries.'));
            console.error(err);
        }
    });
}
function generate_wps_zip(frm) {
    // Validate before processing
    if (!frm.doc.payroll_entries || frm.doc.payroll_entries.length === 0) {
        frappe.msgprint(__('Please select at least one Payroll Entry before generating ZIP.'));
        return;
    }

    frappe.show_progress(__('Generating WPS ZIP'), 0, 100, __('Processing...'));

    frappe.call({
        method: 'run_doc_method',
        args: {
            docs: frm.doc,
            method: 'generate_zip'
        },
        callback: r => handle_zip_response(r, frm, __('generated')),
        error: () => {
            frappe.hide_progress();
            generic_error();
        }
    });
}
function regenerate_zip(frm) {
    frappe.confirm(__('This will regenerate the ZIP file. Continue?'), () => {
        frappe.show_progress(__('Regenerating ZIP'), 0, 100, __('Processing...'));

        frappe.call({
            method: 'run_doc_method',
            args: {
                docs: frm.doc,
                method: 'regenerate_zip'
            },
            callback: r => handle_zip_response(r, frm, __('regenerated')),
            error: () => {
                frappe.hide_progress();
                generic_error();
            }
        });
    });
}
function handle_zip_response(response, frm, verb) {
    frappe.hide_progress();
    if (response.message && response.message.status === 'success') {
        frappe.show_alert({
            message: __(`ZIP file {0} successfully with {1} files`, [verb, response.message.files_count]),
            indicator: 'green'
        });
        frm.reload_doc();
    } else {
        frappe.msgprint({
            title: __('Generation Failed'),
            message: __('Failed to generate ZIP file. Please check the logs for details.'),
            indicator: 'red'
        });
    }
}
function generic_error() {
    frappe.msgprint({
        title: __('Error'),
        message: __('Failed to process ZIP file. Please check the logs.'),
        indicator: 'red'
    });
}
function copy_to_clipboard(text, label) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(() => {
            frappe.show_alert({ 
                message: __('{0} copied to clipboard', [label]), 
                indicator: 'green' 
            });
        }).catch(() => fallback_copy(text, label));
    } else {
        fallback_copy(text, label);
    }
}
function fallback_copy(text, label) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);

    try {
        ta.select();
        document.execCommand('copy');
        frappe.show_alert({ 
            message: __('{0} copied to clipboard', [label]), 
            indicator: 'green' 
        });
    } catch (err) {
        frappe.show_alert({ 
            message: __('Failed to copy {0}', [label]), 
            indicator: 'red' 
        });
    } finally {
        document.body.removeChild(ta);
    }
}
function copyHtmlToClipboard(html, successMessage) {
    // Try modern clipboard API first
    if (navigator.clipboard && window.ClipboardItem) {
        const blob = new Blob([html], { type: 'text/html' });
        const clipboardItem = new ClipboardItem({ 'text/html': blob });
        
        navigator.clipboard.write([clipboardItem]).then(() => {
            frappe.show_alert({ 
                message: successMessage, 
                indicator: 'green' 
            });
        }).catch(() => {
            fallbackHtmlCopy(html, successMessage);
        });
    } else {
        fallbackHtmlCopy(html, successMessage);
    }
}
function fallbackHtmlCopy(html, successMessage) {
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.position = 'fixed';
    container.style.left = '-9999px';
    container.style.top = '-9999px';
    
    document.body.appendChild(container);
    
    const range = document.createRange();
    range.selectNode(container);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    
    let success = false;
    try {
        success = document.execCommand('copy');
    } catch (err) {
        console.error('Copy failed:', err);
    }
    
    document.body.removeChild(container);
    selection.removeAllRanges();
    
    frappe.show_alert({
        message: success ? successMessage : __('Failed to copy to clipboard'),
        indicator: success ? 'green' : 'red'
    });
}
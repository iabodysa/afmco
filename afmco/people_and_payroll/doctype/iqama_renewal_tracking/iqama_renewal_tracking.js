frappe.ui.form.on('Iqama Renewal Tracking', {
    refresh: function(frm) {
        try {
            renderDashboard(frm);
            renderContractCard(frm);
            hideFieldsShownInDashboard(frm);
            updateStatus(frm);
            addCustomButtons(frm);
        } catch (error) {
            logError(error, 'refresh');
        }
    },

    onload: function(frm) {
        try {
            updateStatus(frm);
            updateNewExpiryDate(frm);
            calculateFees(frm);
            calculateTotalAmount(frm);
            updateMuqeemBalanceAfterRenewal(frm);
        } catch (error) {
            logError(error, 'onload');
        }
    },

    before_save: function(frm) {
        try {
            handleStatusTransitions(frm);
        } catch (error) {
            logError(error, 'before_save');
        }
    },

    renewal_duration: function(frm) {
        try {
            updateNewExpiryDate(frm);
            calculateFees(frm);
        } catch (error) {
            logError(error, 'renewal_duration');
        }
    },

    iqama_expiration_date: function(frm) {
        try {
            updateNewExpiryDate(frm);
        } catch (error) {
            logError(error, 'iqama_expiration_date');
        }
    },

    contract_date: function(frm) {
        try {
            updateStatus(frm);
        } catch (error) {
            logError(error, 'contract_date');
        }
    },

    status: function(frm) {
        try {
            updateStatus(frm);
        } catch (error) {
            logError(error, 'status');
        }
    },

    iqama_renewal_amount: function(frm) {
        try {
            calculateTotalAmount(frm);
        } catch (error) {
            logError(error, 'iqama_renewal_amount');
        }
    },

    work_permit_fee: function(frm) {
        try {
            calculateTotalAmount(frm);
        } catch (error) {
            logError(error, 'work_permit_fee');
        }
    },

    exempt_compensation: function(frm) {
        try {
            if (frm.doc.exempt_compensation) {
                frm.set_value('renewal_duration', '1 year');
            }
            calculateFees(frm);
        } catch (error) {
            logError(error, 'exempt_compensation');
        }
    },

    onload_post_render: function(frm) {
        try {
            frm.trigger('check_and_update_status');
        } catch (error) {
            logError(error, 'onload_post_render');
        }
    },

    muqeem_balance: function(frm) {
        try {
            updateMuqeemBalanceAfterRenewal(frm);
        } catch (error) {
            logError(error, 'muqeem_balance');
        }
    },

    muqeem_balance_after_renewal: function(frm) {
        try {
            updateMuqeemBalanceAfterRenewal(frm);
        } catch (error) {
            logError(error, 'muqeem_balance_after_renewal');
        }
    }
});

function ensure_dashboard_style_loaded() {
    if ($('#custom-form-dashboard-styles').length === 0) {
        $('<style id="custom-form-dashboard-styles">').html(`
            .custom-dashboard-section {
                display: flex;
                gap: 15px;
                margin-bottom: 15px;
                flex-wrap: wrap;
            }
            .dashboard-item {
                background: var(--card-bg);
                border-radius: var(--border-radius);
                padding: 15px;
                box-shadow: var(--shadow-sm);
                flex: 1;
                min-width: 200px;
                border-left: 4px solid var(--gray-300);
                transition: transform 0.2s ease-out, box-shadow 0.2s ease-out;
            }
            .dashboard-item:hover {
                transform: translateY(-2px);
                box-shadow: var(--shadow-lg);
            }
            .dashboard-item .title {
                font-size: var(--text-xs);
                color: var(--text-muted);
                font-weight: 500;
                margin-bottom: 5px;
            }
            .dashboard-item .count {
                font-size: var(--text-lg);
                font-weight: 600;
                color: var(--text-color);
            }
            .contract-section {
                width: 100%;
                background: var(--card-bg);
                border-radius: var(--border-radius);
                padding: 20px;
                box-shadow: var(--shadow-sm);
                margin-top: 15px;
            }
            .contract-badge {
                display: inline-block;
                padding: 3px 10px;
                border-radius: 15px;
                font-size: var(--text-xs);
                font-weight: 500;
                color: white;
                margin-right: 10px;
            }
        `).appendTo('head');
    }
}

function renderDashboard(frm) {
    ensure_dashboard_style_loaded();
    
    if (!frm.custom_dashboard_area) {
        frm.custom_dashboard_area = $('<div class="custom-dashboard-section"></div>')
            .prependTo(frm.$wrapper.find('.layout-main-section'));
    }
    
    frm.custom_dashboard_area.empty();
    
    const statusColor = getStatusColor(frm.doc.status);
    const statusHtml = `
        <div class="dashboard-item" style="border-left-color: ${statusColor};">
            <div class="d-flex align-items-center mb-2">
                <i class="fa fa-id-card mr-2" style="color: ${statusColor}"></i>
                <span class="title">${__('Iqama Status')}</span>
            </div>
            <div class="count">${frappe.utils.escape_html(frm.doc.status || 'Unknown')}</div>
        </div>
    `;
    
    frm.custom_dashboard_area.append(statusHtml);
    
    if (frm.doc.employee_status) {
        const employeeHtml = `
            <div class="dashboard-item" style="border-left-color: var(--gray-600);">
                <div class="d-flex align-items-center mb-2">
                    <i class="fa fa-user mr-2" style="color: var(--gray-600)"></i>
                    <span class="title">${__('Employee Status')}</span>
                </div>
                <div class="count">${frappe.utils.escape_html(frm.doc.employee_status)}</div>
            </div>
        `;
        frm.custom_dashboard_area.append(employeeHtml);
    }
    
    if (frm.doc.posting_date) {
        const dateHtml = `
            <div class="dashboard-item" style="border-left-color: var(--blue-500);">
                <div class="d-flex align-items-center mb-2">
                    <i class="fa fa-calendar mr-2" style="color: var(--blue-500)"></i>
                    <span class="title">${__('Posting Date')}</span>
                </div>
                <div class="count">${frappe.datetime.str_to_user(frm.doc.posting_date)}</div>
            </div>
        `;
        frm.custom_dashboard_area.append(dateHtml);
    }
}

function renderContractCard(frm) {
    const contractData = buildContractCard(frm);
    if (!contractData) return;
    
    ensure_dashboard_style_loaded();
    
    if (!frm.contract_dashboard_area) {
        frm.contract_dashboard_area = $('<div></div>')
            .insertAfter(frm.custom_dashboard_area);
    }
    
    const contractHtml = `
        <div class="contract-section" style="border-left: 4px solid ${contractData.color};">
            <div class="d-flex align-items-center mb-3">
                <i class="fa fa-file-contract mr-2" style="color: ${contractData.color}; font-size: 20px;"></i>
                <h5 class="mb-0">${frappe.utils.escape_html(contractData.label)}</h5>
            </div>
            ${contractData.content}
        </div>
    `;
    
    frm.contract_dashboard_area.html(contractHtml);
}

function buildContractCard(frm) {
    const doj = frm.doc.date_of_joining;
    if (!doj) return null;

    try {
        const startDate = frappe.datetime.str_to_obj(doj);
        const today = frappe.datetime.str_to_obj(frappe.datetime.nowdate());
        if (!startDate || !today) throw new Error("Invalid date format");

        const probationEnd = addMonths(startDate, 3);
        let nextAnniv = new Date(startDate);
        nextAnniv.setFullYear(today.getFullYear());
        if (nextAnniv < today) nextAnniv.setFullYear(nextAnniv.getFullYear() + 1);

        const renewalStart = addMonths(nextAnniv, -1);
        const renewalEnd = addMonths(nextAnniv, 1);
        const remainingMonths = diffMonths(nextAnniv, today);
        const totalYears = diffDays(today, startDate) / 365.25;

        let stage = __('Employment Active');
        let color = '#28a745';
        let icon = 'check-circle';
        let note = __('Contract status is active and in good standing.');

        const empState = (frm.doc.employee_status || '').toLowerCase();

        if (empState && empState !== 'active') {
            stage = __('Employment Inactive');
            color = '#6c757d'; 
            icon = 'user-slash';
            note = __('Employee status is {0}. Contract handling not required.', [frm.doc.employee_status]);
        } else if (today < probationEnd) {
            stage = __('Probationary Period');
            color = '#ffc107'; 
            icon = 'user-plus';
            note = __('Employee in probation period until {0}.', [frappe.datetime.obj_to_user(probationEnd)]);
        } else if (totalYears >= 5) {
            stage = __('Senior Tenure');
            color = '#6f42c1'; 
            icon = 'user-clock';
            note = __('Employee has served more than 5 years. Project Manager review required.');
        } else if (today >= renewalStart && today <= renewalEnd) {
            stage = __('Renewal Required');
            color = '#dc3545'; 
            icon = 'exclamation-triangle';
            note = __('Within renewal window ({0} – {1}). Legal review required.', [
                frappe.datetime.obj_to_user(renewalStart), 
                frappe.datetime.obj_to_user(renewalEnd)
            ]);
        } else if (today > renewalEnd) {
            stage = __('Renewal Overdue');
            color = '#dc3545'; 
            icon = 'exclamation-circle';
            note = __('Missed renewal window. Follow up with HR / Legal immediately.');
        }

        const content = `
            <div class="d-flex align-items-center mb-2">
                <span class="contract-badge" style="background-color:${color};">${frappe.utils.escape_html(stage)}</span>
                <strong>${frappe.utils.escape_html(frappe.datetime.obj_to_user(nextAnniv))}</strong>
            </div>
            <div class="d-flex align-items-center mb-3">
                <i class="fa fa-calendar-alt mr-2" style="color:${color};"></i>
                <span>${frappe.utils.escape_html(remainingMonths.toString())} ${__('months remaining')}</span>
            </div>
            <div class="alert alert-light p-2 mb-0">
                <i class="fa fa-${icon} mr-2" style="color:${color};"></i>
                <span>${frappe.utils.escape_html(note)}</span>
            </div>
        `;
        
        return { label: __('Employment Contract Overview'), content, color };
    } catch (e) {
        return {
            label: __('Employment Contract Overview'),
            content: `<div class="alert alert-danger p-2 mb-0">
                <i class="fa fa-exclamation-circle mr-2"></i>
                <span>${__('Unable to calculate contract. Check joining date.')}</span>
            </div>`,
            color: '#dc3545'
        };
    }
}

function hideFieldsShownInDashboard(frm) {
    frm.set_df_property('status', 'hidden', 1);
    frm.set_df_property('employee_status', 'hidden', 1);
    frm.set_df_property('posting_date', 'hidden', 1);
}

function addCustomButtons(frm) {
    if (frm.doc.status === 'Awaiting Operations Approval') {
        frm.add_custom_button(__('Schedule for Later'), () => {
            frappe.prompt([
                {
                    fieldname: 'reschedule_date',
                    fieldtype: 'Date',
                    label: __('Select reschedule date'),
                    reqd: 1
                }
            ], (values) => {
                frm.set_value('status', 'Rescheduled');
                frm.set_value('reschedule_date', values.reschedule_date);
                frm.save();
                frappe.show_alert({
                    message: __('Scheduled for {0}', [values.reschedule_date]),
                    indicator: 'blue'
                });
            }, __('Schedule Request'));
        });
    }
}

function handleStatusTransitions(frm) {
    if (frm.doc.renewal_preference == 'Yes' && 
        frm.doc.status == 'Awaiting Operations Approval' && 
        frm.doc.renewal_duration) {
        frm.set_value('status', 'Awaiting Payment');
        showNotification(__('Status has been changed to Awaiting Payment'));
    } else if (frm.doc.renewal_preference == 'NO' && 
               frm.doc.status == 'Awaiting Operations Approval' && 
               frm.doc.reason_of_not_renew) {
        frm.set_value('status', 'Rejected');
        showNotification(__('Status has been changed to Rejected'));
    }
}

function updateNewExpiryDate(frm) {
    if (frm.doc.iqama_expiration_date && frm.doc.renewal_duration) {
        const months = getMonthsFromDuration(frm.doc.renewal_duration);
        const newExpiryDate = frappe.datetime.add_months(frm.doc.iqama_expiration_date, months);
        frm.set_value('iqama_new_expiration_date', newExpiryDate);
    }
}

function getMonthsFromDuration(duration) {
    const durationMap = {
        '3 months': 3,
        '3 أشهر': 3,
        '6 months': 6,
        '6 أشهر': 6,
        '9 months': 9,
        '9 أشهر': 9,
        '1 year': 12,
        'سنة واحدة': 12
    };
    
    return durationMap[duration] || 0;
}

function updateStatus(frm) {
    if (frm.doc.contract_date && frm.doc.status === 'Waiting for Legal Approval') {
        frm.set_value('status', 'Awaiting Payment');
        showNotification(__('Status has been changed to Awaiting Payment'));
        frm.save_or_update();
    }
    updateMuqeemBalanceAfterRenewal(frm);
}

function calculateTotalAmount(frm) {
    const total = (frm.doc.iqama_renewal_amount || 0) + 
                 (frm.doc.work_permit_fee || 0) + 
                 (frm.doc.traffic_violation_balance || 0);
    frm.set_value('total_amount', total);
}

function calculateFees(frm) {
    let iqamaFee = 0;
    let workPermitFee = 0;
    let months = getMonthsFromDuration(frm.doc.renewal_duration);

    if (frm.doc.exempt_compensation) {
        if (months !== 12) {
            showNotification('Duration must be 1 year for exempted cases.');
            frm.set_value('renewal_duration', '1 year');
            months = 12;
        }
        workPermitFee = 100.00;
    } else {
        const workPermitFeeMap = {
            3: 2425.00,
            6: 4850.00,
            9: 7275.00,
            12: 9700.00
        };
        
        workPermitFee = workPermitFeeMap[months] || 0;
    }

    const iqamaFeeMap = {
        3: 163.00,
        6: 325.00,
        9: 488.00,
        12: 650.00
    };
    
    iqamaFee = iqamaFeeMap[months] || 0;

    frm.set_value('iqama_renewal_amount', iqamaFee);
    frm.set_value('work_permit_fee', workPermitFee);
    calculateTotalAmount(frm);
}

function showNotification(message, indicator = 'green') {
    try {
        frappe.show_alert({
            message: message,
            indicator: indicator
        });
    } catch (error) {
        frappe.show_alert({
            message: message,
            indicator: 'red'
        });
        logError(error, 'showNotification');
    }
}

function updateMuqeemBalanceAfterRenewal(frm) {
    const renewalAmount = frm.doc.iqama_renewal_amount || 0;
    const muqeemBalance = frm.doc.muqeem_balance || 0;

    const newBalance = frm.doc.status === 'Renewed' ? 
                      muqeemBalance : 
                      muqeemBalance + renewalAmount;
    
    frm.set_value('muqeem_balance_after_renewal', newBalance);
    frm.set_value('refundable_balance', newBalance > 0 ? 1 : 0);
}

function logError(error, source) {
    console.error(`Error in ${source}:`, error);
    showNotification(
        __('An error occurred in {0}. Please check the console for more details.').replace('{0}', source),
        'red'
    );
}

function getStatusColor(status) {
    const statusColors = {
        "New": "var(--green)",
        "Awaiting Operations Approval": "var(--orange)",
        "Waiting for Legal Approval": "var(--blue)",
        "Awaiting Payment": "var(--yellow)",
        "Awaiting Renewal": "var(--purple)",
        "Issue Preventing Renewal": "var(--red)",
        "Renewed": "var(--dark-green)",
        "Rejected": "var(--gray-600)",
        "Rescheduled": "var(--light-blue)"
    };
    return statusColors[status] || "var(--gray-400)";
}

function addMonths(d, m) { 
    const x = new Date(d); 
    x.setMonth(x.getMonth() + m); 
    return x; 
}

function diffMonths(a, b) { 
    return (a.getFullYear() - b.getFullYear()) * 12 + (a.getMonth() - b.getMonth()); 
}

function diffDays(a, b) { 
    return Math.floor((a - b) / 864e5); 
}
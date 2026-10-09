frappe.ui.form.on('End of Service Settlement', {
    
    onload(frm) {
      //  frm.tour.init({ tour_name: 'EOS' }).then(() => frm.tour.start());
    },
updateFieldValueAndRefreshForm: function(frm, fieldName, value) {
    let currentValue = frm.doc[fieldName];
    if (currentValue !== value) {
      frm.set_value(fieldName, value.toFixed(2));
      frm.refresh_field(fieldName);
    }
  },
  before_save: function(frm) {
      ['salary_per_day', 'duration_of_service', 'dos_years', 'cva_total','total_eos', 'deductions', 'amount'].forEach(field => {
      frm.set_df_property(field, 'read_only', 0);
    });
    frm.events.calculateServiceDuration(frm); 
    adjust_ticket_allowance(frm);
  },
    after_insert: function(frm) {
     
    if (frm.doc.cva && frm.doc.cva.length === 0) {
        frm.events.calculateVacationAllowance(frm);
        
    } 
  },
  validate: function(frm) {
    checkDuplicateContractStartDate(frm);
    const requiredFields = [
      'account_no',
      'date_1',
      'date_2',
      'total_salary',
      'vacation_days_per_year',
    ];

    requiredFields.forEach((field) => {
      if (!frm.doc[field]) {
        frappe.validated = false;
        //frappe.msgprint(__('Please fill out all required fields.'));
        frappe.msgprint(__('Please fill the field: {0}', [frappe.meta.get_label(frm.doc.doctype, field, frm.doc.name)]));
      }
    });
    check_service_period(frm);
  },
    refresh: function(frm) {
        add_qiwa_calculator_button(frm);
        renderEOSCalculations(frm);
        showEosCalculationDetails(frm);
        frm.user_confirmed = false;
      ['salary_per_day', 'duration_of_service', 'dos_years', 'cva_total','total_eos', 'deductions', 'amount'].forEach(field => {
      frm.set_df_property(field, 'read_only', 1);
    });
    if (frm.doc.workflow_state === 'Waiting Accountant Approval') {
        frm.set_df_property('cva', 'read_only', 0); 
        
    } else {
        frm.set_df_property('cva', 'read_only', 1);
        
    }
    frm.add_custom_button('watsapp', function() {
            if (frm.doc.cell_number && frm.doc.cell_number.length >= 9) {
                var modified_number = frm.doc.cell_number.slice(-9);
                var full_number = "966" + modified_number;
                var message = `Good day Mr. ${frm.doc.employee_name},\n\n` +
                              `Please come to the company to sign the financial clearance form and collect the clearance amount. Our business hours are from 9:00 AM to 5:00 PM.\n\n` +
                              `Location: https://maps.app.goo.gl/9BWyrvjZ1YEuBdVf9\n\n` +
                              `Thank you for your cooperation.\n\n` +
                              `Sincerely,\nHR Team\nAFMCO.LTD`;
                var encoded_message = encodeURIComponent(message);

                var whatsapp_link = "https://wa.me/" + full_number + "?text=" + encoded_message;
                window.open(whatsapp_link, '_blank');
            } else {
                frappe.msgprint(__('Please enter a valid cell number with at least 9 digits.'));
            }
        }).addClass('btn-primary');
    if (frm.doc.workflow_state === 'Approved' && frm.doc.pr_status == 'PR Not Created') {
      frm.add_custom_button(frappe._('Create PR'), () => {
        frm.set_value('pr_status', 'PR Created');
        frm.save();
        const expenseRequest = frappe.model.get_new_doc('Payment Requisition');
        expenseRequest.tax_invoice_number = frm.doc.name;
        expenseRequest.beneficiary_name = `${frm.doc.employee_name} ${frm.doc.employee}`;
        expenseRequest.amount = frm.doc.amount;
        expenseRequest.project = frm.doc.payroll_cost_center;
        expenseRequest.cost_center = frm.doc.branch;
        expenseRequest.jv_status = 'JV Not Created';
        expenseRequest.naming_series = 'PR-.YYYY.-';
        expenseRequest.date = frappe.datetime.nowdate();
        expenseRequest.bank_payment_date = frappe.datetime.nowdate();
        expenseRequest.payment_type = 'EOS';
        expenseRequest.remark = `End of Service Benefits:
- Employee Name: ${frm.doc.employee_name}
- Employee ID: ${frm.doc.employee}
- Total Salary: ${frm.doc.total_salary}
- Daily Salary: ${frm.doc.salary_per_day}
- Ticket Allowance: ${frm.doc.ticket_allowance}
- EOS: ${frm.doc.total_eos}
- Deductions: ${frm.doc.deductions}
- Total Vacation Allowance: ${frm.doc.cva_total}
- Total Amount: ${frm.doc.amount}`;
        if (frm.doc.check3 == 1) {
            expenseRequest.mode_of_payment = 'Cash Payment';
            expenseRequest.account_no = 'Cash Payment Account Suspended';
        } else {
            expenseRequest.mode_of_payment = 'Bank Transfer';
            expenseRequest.account_no = frm.doc.account_no;
        }
        frappe.set_route('Form', expenseRequest.doctype, expenseRequest.name);
      }).addClass('btn-danger');
    }
    if (frm.doc.workflow_state === 'Waiting Accountant Approval') {
      frm.add_custom_button(frappe._('Get Advance Leave Salary'),
        () => {
          frm.events.calculateVacationAllowance(frm);
        }).addClass('btn-primary');
    }
  },
  calculateVacationAllowance: async function(frm) {
    let Las_Day = new Date(frm.doc.date_2);
    let contractStartDate = new Date(frm.doc.date_1);
    let contractEndDate = new Date(contractStartDate);
    contractEndDate.setDate(contractEndDate.getDate() + 365);
    
   
    const rows = [];

    let j = 0;

    while (j < frm.doc.dos_years) {
      let contractEndDateCopy = new Date(contractEndDate);
      if (contractEndDateCopy > Las_Day) {
            contractEndDateCopy = Las_Day;
            
        }

      if (j === frm.doc.dos_years - 1) {
        contractEndDateCopy = new Date(frm.doc.date_2);
        
      }

      const mysqlFormatEnd = contractEndDateCopy.toISOString().slice(0, 19).replace('T', ' ');
      const mysqlFormatStart = contractStartDate.toISOString().slice(0, 19).replace('T', ' ');
      let daysBetween = (contractEndDateCopy - contractStartDate) / (1000 * 60 * 60 * 24);
      if (daysBetween === 365) {
          daysBetween = 364;
          
      }
     // const amount = Math.round(frm.doc.salary_per_day * (daysBetween / 364 * frm.doc.vacation_days_per_year));
    let vacation_days_per_year = frm.doc.vacation_days_per_year || 21;

    if (j + 1 >= 6 && vacation_days_per_year < 30) {
        vacation_days_per_year = 30;
    }

    const amount = Math.round(frm.doc.salary_per_day * (daysBetween / 364 * vacation_days_per_year));
    // now 2025
      rows.push({
        contract_start_date: mysqlFormatStart,
        contract_end_date: mysqlFormatEnd,
        status: 'unpaid',
        note: 'اضف ملاحظاتك هنا ',
        vad: vacation_days_per_year,
        amount3: amount,
      });
      contractStartDate = new Date(contractEndDate.setDate(contractEndDate.getDate() + 1));
      contractEndDate.setDate(contractEndDate.getDate() + 364);

      j += 1;
    }

    rows.forEach((rowData) => {
      const row = frm.add_child('cva');
      Object.keys(rowData).forEach((key) => {
        frappe.model.set_value(row.doctype, row.name, key, rowData[key]);
      });
    });
    await checkPreviousVacations(frm);
    frm.refresh();
    frm.events.calculateServiceDuration(frm);
  },
  calculateServiceDuration: function(frm) {
      const dailySalary = frm.doc.total_salary / 30;
      frm.events.updateFieldValueAndRefreshForm(frm, 'salary_per_day', dailySalary);
    const diffInDates = frappe.datetime.get_diff(frm.doc.date_2, frm.doc.date_1);
    const yearsOfService = diffInDates / 365;
    const endOfServiceReason = frm.doc.end_of_service_reason;
    let daysOfEOS = frm.doc.days_of_eos;
    if (/^3-Termination by the employer under Article 80$|^7-Termination by the employee or termination of employment by the employee for reasons other than those specified in Article 81$/.test(endOfServiceReason)) {
      daysOfEOS = 0;
    } else if (/^1-End of term or mutual agreement$|^2-Termination by the employer$|^4-Termination due to force majeure$|^5-Termination of the contract by the female employee during the first six months of marriage or during the first three months of childbirth$|^6-Termination by the employee under Article 81$/.test(endOfServiceReason)) {
      if (diffInDates <= 1826) {
      daysOfEOS = (diffInDates / 365) * 15;
    } else {
    daysOfEOS = Math.round(75 + ((diffInDates - 1825) * (30 / 365)));
    //daysOfEOS = 75 + ((diffInDates - 1825) * (30 / 365));
    }
    } else if (/^8-Resignation$/.test(endOfServiceReason) && yearsOfService < 2) {
      daysOfEOS = 0;
    } else if (/^8-Resignation$/.test(endOfServiceReason) && yearsOfService >= 2 && yearsOfService < 5) {
      daysOfEOS = (( diffInDates / 365) * 15) * 0.3334;
    } else if (/^8-Resignation$/.test(endOfServiceReason) && yearsOfService >= 5 && yearsOfService < 10) {
    let afterFiveYears = ((diffInDates - 1825) / 365)*30;
    let totalDays = 75 + afterFiveYears;
    daysOfEOS = totalDays * (2 / 3);
    } else if (/^8-Resignation$/.test(endOfServiceReason) && yearsOfService > 10) {
      daysOfEOS = ( diffInDates / 365) * 15;
    }
    if (daysOfEOS !== undefined) {
      
    }
    let totalVacationAllowance = 0;
    $.each(frm.doc.cva || [], (i, d) => {
      if (d.status && d.status === 'Paid') {
      } else {
        totalVacationAllowance += d.amount3;
      }
    });
    let totalDeductions = 0;
    $.each(frm.doc.table_14 || [], (i, d) => {
      if (d.amount2) {
        totalDeductions += d.amount2;
      }
    });
    const years = Math.floor(diffInDates / 365);
    const remainingDaysAfterYears = diffInDates % 365;
    const months = Math.floor(remainingDaysAfterYears / 30);
    const days = remainingDaysAfterYears % 30;
    frm.events.updateFieldValueAndRefreshForm(frm, 'years', years);
    frm.events.updateFieldValueAndRefreshForm(frm, 'months', months);
    frm.events.updateFieldValueAndRefreshForm(frm, 'days', days);
    let alternative_reward = frm.doc.alternative_reward || 0; // Corrected the syntax here

    let safeTicketAllowance;
    if (frm.doc.term === "Transfer of sponsorship" && frm.doc.check1 === 0) {
        safeTicketAllowance = 0;

    } else {
        safeTicketAllowance = frm.doc.ticket_allowance || 0;
        
    }
    const totalEOS = parseFloat((daysOfEOS * frm.doc.salary_per_day).toFixed(2));
    //const totalEOS = Math.round(daysOfEOS * frm.doc.salary_per_day);
    const safePenaltyClause = frm.doc.penalty_clause || 0; // new
    const safeTotalEOS = totalEOS || 0;
    const safeTotalVacationAllowance = Math.round(totalVacationAllowance || 0);
    const safeTotalDeductions = totalDeductions || 0;
    const totalAmount = Math.round(safeTotalEOS + safeTotalVacationAllowance + alternative_reward + safeTicketAllowance - safeTotalDeductions - safePenaltyClause);
    frm.events.updateFieldValueAndRefreshForm(frm, 'total_eos', safeTotalEOS);
    frm.events.updateFieldValueAndRefreshForm(frm, 'dos_years', yearsOfService);
    frm.events.updateFieldValueAndRefreshForm(frm, 'duration_of_service', diffInDates);
    frm.events.updateFieldValueAndRefreshForm(frm, 'days_of_eos', daysOfEOS);
    frm.events.updateFieldValueAndRefreshForm(frm, 'cva_total', safeTotalVacationAllowance);
    frm.events.updateFieldValueAndRefreshForm(frm, 'deductions', totalDeductions);
    frm.events.updateFieldValueAndRefreshForm(frm, 'amount', totalAmount);
    frm.refresh_field('cva');
    

    },
  });

function checkPreviousVacations(frm) {
  return frappe.db.get_list('Advance Leave Salary', {
    filters: {
      'employee': frm.doc.employee,
      'name': ['!=', frm.doc.name],
      'workflow_state': ['in', ['Approved', 'Paid']]

    },
    fields: ['name']
  }).then(records => {
    if (records.length > 0) {
      let message = `<h4>${__('Found', null, 'End of Service Settlement')} ${records.length} ${__('previous leave settlements for this employee:', null, 'End of Service Settlement')}</h4><ul>`;

      return Promise.all(records.map(record => {
        return frappe.db.get_doc('Advance Leave Salary', record.name).then(doc => {
          const marks = [];
          doc.cva.forEach((childRow, index) => {
            let childStartDate = new Date(childRow.contract_start_date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
            let childEndDate = new Date(childRow.contract_end_date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });

            message += `<li>${index + 1}. ${__('Settlement No.', null, 'End of Service Settlement')} ${record.name}: ${childStartDate} ${__('to', null, 'End of Service Settlement')} ${childEndDate}</li>`;
            
            // Update employee status here
            frm.doc.cva.forEach(newRow => {
              if (
                  frappe.datetime.get_diff(childRow.contract_end_date, newRow.contract_start_date) > 0 &&
                  frappe.datetime.get_diff(newRow.contract_end_date, childRow.contract_start_date) > 0
                  ) {
                marks.push(frappe.model.set_value(newRow.doctype, newRow.name, 'status', 'Paid'));
              }
            });
          });
          return Promise.all(marks);
        });
      })).then(() => {
        message += "</ul>";
        frappe.msgprint(message);
        frm.refresh_field('cva');
      });

    } else {
      frappe.msgprint(__('No previous settlement exists for this employee.', null, 'End of Service Settlement'));
    }
  });
}
function check_service_period(frm) {
  if (frm.user_confirmed) {
    return;
  }

  let diff = frappe.datetime.get_diff(frm.doc.date_2, frm.doc.date_1);
  let years = diff / 365;

  if (years < 2) {
    frappe.validated = false;
    frappe.confirm(
      `<h4 style="color: #0072BC;">${__("Attention", null, "End of Service Settlement")}</h4>` +
      `<p>${__("The duration of the employee's service is less than two years, which may affect certain calculations and entitlements.", null, "End of Service Settlement")}</p>` +
      `<p><strong>${__("Do you wish to continue?", null, "End of Service Settlement")}</strong></p>`,
      function() {
        frm.user_confirmed = true;
        frappe.validated = true;
        setTimeout(() => frm.save(), 1);
      },
      function() {
        frappe.validated = false;
      }
    );
  }
}
function adjust_ticket_allowance(frm) {
    if(frm.doc.__islocal || !frm.doc.ticket_allowance_confirmed) {
        let reason = frm.doc.end_of_service_reason;
        if (!(/^1-End of term or mutual agreement$|^2-Termination by the employer$|^4-Termination due to force majeure$|^5-Termination of the contract by the female employee during the first six months of marriage or during the first three months of childbirth$|^6-Termination by the employee under Article 81$/).test(reason) && frm.doc.ticket_allowance > 0) {
            frappe.confirm(
                `<h4 style="color: #3498DB;">${__("Important Notice", null, "End of Service Settlement")}</h4>` +
                `<p style="font-size: 16px;">${__("Based on the End of Service Reason, it appears the employee <strong>does not qualify</strong> for a ticket allowance. Currently, the ticket allowance is set to <strong>{0}</strong>.", [frm.doc.ticket_allowance], "End of Service Settlement")}</p>` +
                `<p style="font-size: 16px;">${__("Do you still wish to proceed with allocating the ticket allowance?", null, "End of Service Settlement")}</p>` +
                `<p style="font-size: 16px; color: #E74C3C;"><em>${__("This action is irreversible once confirmed.", null, "End of Service Settlement")}</em></p>`,
                () => {
                    frm.set_value('ticket_allowance_confirmed', true);
                    frappe.show_alert({message: __('The ticket allowance will be allocated as per your decision.'), indicator: 'green'});
                },
                () => {
                    frm.set_value('ticket_allowance', 0);
                    frm.set_value('ticket_allowance_confirmed', true);
                }
            );
        }
    }
}
function checkDuplicateContractStartDate(frm) {
    let unique_start_dates = new Set();
    let duplicates_found = false;

    frm.doc.cva.forEach(function(row) {
        if (unique_start_dates.has(row.contract_start_date)) {
            duplicates_found = true;
        } else {
            unique_start_dates.add(row.contract_start_date);
        }
    });

    if (duplicates_found) {
        frappe.msgprint(__('Please note that contract period start dates are repeated. Please review the data and make sure the dates do not overlap so the procedure is correct.', null, 'End of Service Settlement'));
        frappe.validated = false;
    }
}
function showEosCalculationDetails(frm) {
    const endOfServiceReason = frm.doc.end_of_service_reason || "";
    const startDate = frm.doc.date_1 || "";
    const endDate = frm.doc.date_2 || "";

    let message = "";
    let color = "blue";

    const reasonCode = endOfServiceReason.split("-")[0];
    const diffInDates = frappe.datetime.get_diff(endDate, startDate);
    const yearsOfService = diffInDates / 365;

    if (reasonCode === "8") {
        if (yearsOfService < 2) {
            message = __('The employee is not entitled to end-of-service benefits due to resignation with less than 2 years of service.', null, 'End of Service Settlement');
            color = "red";
        } else if (yearsOfService < 5) {
            message = __('The employee is entitled to one-third of the end-of-service benefits due to resignation with service between 2 and 5 years.', null, 'End of Service Settlement');
            color = "orange";
        } else if (yearsOfService < 10) {
            message = __('The employee is entitled to two-thirds of the end-of-service benefits due to resignation with service between 5 and 10 years.', null, 'End of Service Settlement');
            color = "orange";
        } else {
            message = __('The employee is entitled to full end-of-service benefits due to resignation with service exceeding 10 years.', null, 'End of Service Settlement');
            color = "green";
        }
    } else if (reasonCode === "3") {
        message = __('The employee is not entitled to end-of-service benefits due to termination under Article 80 of the Labor Law.', null, 'End of Service Settlement');
        color = "red";
    } else if (["1", "2", "4"].includes(reasonCode)) {
        message = __('The employee is entitled to full end-of-service benefits due to contract termination, mutual agreement, or force majeure.', null, 'End of Service Settlement');
        color = "green";
    } else if (reasonCode === "5") {
        message = __('The employee is not entitled to end-of-service benefits due to resignation within six months of marriage or three months after childbirth.', null, 'End of Service Settlement');
        color = "red";
    } else if (reasonCode === "6") {
        message = __('The employee is entitled to full end-of-service benefits due to resignation under Article 81 of the Labor Law.', null, 'End of Service Settlement');
        color = "green";
    } else if (reasonCode === "7") {
        message = __('The employee is entitled to end-of-service benefits based on service duration due to other resignation reasons.', null, 'End of Service Settlement');
        color = "green";
    }

    frm.set_intro("");

    if (message) {
        frm.set_intro(message, color);
    }
}
function add_qiwa_calculator_button(frm) {
  if (!frappe.user.has_role('System Manager')) {
    return;
  }

  frm.add_custom_button('Qiwa EOS Calculator', async function () {
    if (!frm.doc.date_1 || !frm.doc.date_2 || !frm.doc.total_salary || !frm.doc.end_of_service_reason) {
      frappe.msgprint('Please complete all required fields: Start Date, End Date, Salary, End of Service Reason.');
      return;
    }

    const startDate = frappe.datetime.str_to_obj(frm.doc.date_1).toISOString().split('T')[0];
    const endDate = frappe.datetime.str_to_obj(frm.doc.date_2).toISOString().split('T')[0];
    const salary = frm.doc.total_salary;
    const reasonCode = get_qiwa_reason_code(frm.doc.end_of_service_reason);
    let contractType = frm.doc.contract_type || 1;

    const diffInDates = frappe.datetime.get_diff(frm.doc.date_2, frm.doc.date_1);
    if (contractType == 1 && diffInDates / 365 > 5) {
      contractType = 2;
    }

    const codeToCopy = `
(async () => {
  const startDate = "${startDate}";
  const endDate = "${endDate}";
  const salary = ${salary};
  const contractType = ${contractType};
  const contractEndReason = ${reasonCode};

  try {
    const response = await fetch(\`https://knowledge-center-be.qiwa.sa/api/v1/end-of-service-lookup?StartDate=\${startDate}&EndDate=\${endDate}&Salary=\${salary}&ContractTypeCode=\${contractType}&ContractEndReasonCode=\${contractEndReason}\`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (data?.RewardAmount !== undefined) {
      document.body.innerHTML = \`
        <div style="min-height: 100vh; display: flex; justify-content: center; align-items: center; background: linear-gradient(135deg, #74ebd5 0%, #ACB6E5 100%); font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px;">
          <div style="background: #fff; padding: 40px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); max-width: 700px; width: 100%;">
            <h1 style="color: #0072BC; text-align: center; margin-bottom: 30px;">End of Service Details</h1>
            <div style="font-size: 18px; line-height: 1.8; color: #333;">
              <p><strong>Start Date:</strong> \${data.StartDate}</p>
              <p><strong>End Date:</strong> \${data.EndDate}</p>
              <p><strong>Monthly Salary:</strong> \${data.Salary} SAR</p>
              <p><strong>Contract Type:</strong> \${contractType == 1 ? 'Limited' : 'Unlimited'}</p>
              <p><strong>End of Service Reason Code:</strong> \${contractEndReason}</p>
              <p><strong>Service Duration:</strong> \${data.Duration}</p>
              <p style="font-size: 22px; color: green; margin-top: 20px;"><strong>EOS Reward:</strong> \${parseFloat(data.RewardAmount).toFixed(2)} SAR</p>
            </div>
          </div>
        </div>
      \`;
    } else {
      alert('Failed to retrieve End of Service reward.');
    }
  } catch (error) {
    console.error('Error:', error);
    alert('An error occurred while contacting Qiwa service.');
  }
})();
    `.trim();

    await navigator.clipboard.writeText(codeToCopy);

    frappe.msgprint('The Qiwa request script has been copied to your clipboard. Open the Qiwa calculator page and paste the script into the browser console.');

    window.open('https://www.qiwa.sa/ar/tools-and-calculators/end-of-service-reward-calculator', '_blank');
  }).addClass('btn-primary');
}
function get_qiwa_reason_code(reason) {
  if (!reason) return "";
  const code = reason.split("-")[0].trim();
  switch (code) {
    case "1": return 4;
    case "2": return 5;
    case "3": return 5;
    case "4": return 4;
    case "5": return 20;
    case "6": return 6;
    case "7": return 7;
    case "8": return 1;
    default: return "";
  }
}

function renderEOSCalculations(frm) {
    if (!frm.doc.employee) return;
    
    $("div").remove(".form-dashboard-section.custom");
    
    let safeTicketAllowance2;
    if (frm.doc.term === "Transfer of sponsorship" && frm.doc.check1 === 0) {
        safeTicketAllowance2 = 0;
    } else {
        safeTicketAllowance2 = frm.doc.ticket_allowance || 0;
    }
    
    const cva_paid = (frm.doc.cva || []).filter(c => c.status === 'Paid').reduce((sum, c) => sum + (c.amount3 || 0), 0);
    const cva_unpaid = (frm.doc.cva || []).filter(c => c.status !== 'Paid').reduce((sum, c) => sum + (c.amount3 || 0), 0);
    const total_benefits = (frm.doc.cva_total || 0) + (frm.doc.total_eos || 0) + (safeTicketAllowance2 || 0);
    const ticket_eligible = (frm.doc.term === "Transfer of sponsorship" && frm.doc.check1 === 0) ? 'No' : 'Yes';
    
    const html = `
        <div id="eos-dashboard">
            <div class="eos-summary">
                <div class="summary-card">
                    <div class="summary-label">Total Benefits</div>
                    <div class="summary-value">${fmt(total_benefits)}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Deductions</div>
                    <div class="summary-value">${fmt(frm.doc.deductions || 0)}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Net Amount</div>
                    <div class="summary-value primary">${fmt(frm.doc.amount || 0)}</div>
                </div>
                <div class="summary-card">
                    <div class="summary-label">Service Duration</div>
                    <div class="summary-value">${frm.doc.dos_years || 0} Years</div>
                </div>
            </div>
            
            <div class="row">
                <div class="col-md-6 mb-2">
                    <div class="eos-card">
                        <div class="card-header">
                            <span class="card-title">Financial Details</span>
                        </div>
                        <table class="eos-table">
                            <tbody>
                                <tr>
                                    <td>CVA Paid</td>
                                    <td class="amount-cell">${fmt(cva_paid)}</td>
                                </tr>
                                <tr>
                                    <td>CVA Unpaid</td>
                                    <td class="amount-cell">${fmt(cva_unpaid)}</td>
                                </tr>
                                <tr>
                                    <td>End of Service</td>
                                    <td class="amount-cell">${fmt(frm.doc.total_eos || 0)}</td>
                                </tr>
                                <tr>
                                    <td>Ticket Allowance</td>
                                    <td class="amount-cell">${fmt(frm.doc.ticket_allowance || 0)}</td>
                                </tr>
                                <tr class="total-row">
                                    <td><strong>Total</strong></td>
                                    <td class="amount-cell total">${fmt(frm.doc.amount || 0)}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                
                <div class="col-md-6 mb-2">
                    <div class="eos-card">
                        <div class="card-header">
                            <span class="card-title">Service & Salary Info</span>
                        </div>
                        <table class="eos-table">
                            <tbody>
                                <tr>
                                    <td>Basic Salary</td>
                                    <td class="amount-cell">${fmt(frm.doc.total_salary || 0)}</td>
                                </tr>
                                <tr>
                                    <td>Salary per Day</td>
                                    <td class="amount-cell">${fmt(frm.doc.salary_per_day || 0)}</td>
                                </tr>
                                <tr>
                                    <td>Service Period</td>
                                    <td class="amount-cell">${parseInt(frm.doc.years || 0)}Y ${parseInt(frm.doc.months || 0)}M ${parseInt(frm.doc.days || 0)}D</td>
                                </tr>
                                <tr>
                                    <td>Ticket Eligible</td>
                                    <td class="amount-cell">${ticket_eligible}</td>
                                </tr>
                                <tr>
                                    <td>PR Status</td>
                                    <td class="amount-cell">
                                        <span class="indicator-pill ${frm.doc.pr_status === 'PR Created' ? 'success' : 'warning'}">${frm.doc.pr_status || 'Not Created'}</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
            
            <style>
                #eos-dashboard { margin: 10px 0; }
                .eos-summary {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                    gap: 8px;
                    margin-bottom: 10px;
                }
                .eos-summary .summary-card {
                    background: var(--card-bg, #ffffff);
                    border: 1px solid var(--border-color);
                    border-radius: var(--border-radius);
                    padding: 8px 10px;
                }
                .eos-summary .summary-label {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-bottom: 4px;
                }
                .eos-summary .summary-value {
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-color);
                    line-height: 1.2;
                }
                .eos-summary .summary-value.primary {
                    color: var(--primary);
                }
                .eos-card {
                    background: var(--card-bg, #ffffff);
                    border: 1px solid var(--border-color);
                    border-radius: var(--border-radius);
                    overflow: hidden;
                }
                .eos-card .card-header {
                    padding: 8px 10px;
                    background: var(--bg-light-gray);
                    border-bottom: 1px solid var(--border-color);
                }
                .eos-card .card-title {
                    font-weight: 500;
                    color: var(--text-color);
                    font-size: 13px;
                }
                .eos-table {
                    width: 100%;
                    margin: 0;
                    border-collapse: collapse;
                }
                .eos-table tbody td {
                    padding: 6px 10px;
                    font-size: 13px;
                    color: var(--text-color);
                    border-bottom: 1px solid var(--table-border-color);
                }
                .eos-table tbody td:first-child {
                    color: var(--text-muted);
                }
                .eos-table tbody tr:last-child td {
                    border-bottom: none;
                }
                .eos-table tbody tr:hover {
                    background: var(--table-hover-bg, #f9fafb);
                }
                .eos-table .amount-cell {
                    text-align: right;
                    font-weight: 500;
                    font-variant-numeric: tabular-nums;
                }
                .eos-table .total-row {
                    border-top: 2px solid var(--border-color);
                }
                .eos-table .total-row td {
                    padding-top: 8px;
                }
                .eos-table .amount-cell.total {
                    color: var(--primary);
                    font-weight: 600;
                    font-size: 14px;
                }
                .indicator-pill {
                    padding: 2px 8px;
                    border-radius: 10px;
                    font-size: 11px;
                    font-weight: 500;
                    display: inline-block;
                }
                .indicator-pill.success {
                    background: var(--indicator-green-bg, #dcfce7);
                    color: var(--indicator-green, #15803d);
                }
                .indicator-pill.warning {
                    background: var(--indicator-yellow-bg, #fef9c3);
                    color: var(--indicator-yellow, #a16207);
                }
            </style>
        </div>
    `;
    
    frm.dashboard.add_section(html, __('EOS Calculations'));
    frm.dashboard.show();
}
function renderEOSCalculations_old(frm) {
    if (!frm.doc.employee) return;
    
    $("div").remove(".form-dashboard-section.custom");
    
    let safeTicketAllowance2;
    if (frm.doc.term === "Transfer of sponsorship" && frm.doc.check1 === 0) {
        safeTicketAllowance2 = 0;

    } else {
        safeTicketAllowance2 = frm.doc.ticket_allowance || 0;
        
    };
    const cva_paid = (frm.doc.cva || []).filter(c => c.status === 'Paid').reduce((sum, c) => sum + (c.amount3 || 0), 0);
    const cva_unpaid = (frm.doc.cva || []).filter(c => c.status !== 'Paid').reduce((sum, c) => sum + (c.amount3 || 0), 0);
    const total_benefits = (frm.doc.cva_total || 0) + (frm.doc.total_eos || 0) + (safeTicketAllowance2 || 0);
    const pr_color = frm.doc.pr_status === 'PR Created' ? 'green' : 'orange';
    const ticket_eligible = (frm.doc.term === "Transfer of sponsorship" && frm.doc.check1 === 0) ? 'No' : 'Yes';
    
    
    const html = `
        <div class="frappe-card" style="margin-bottom: 15px;">
            <div class="row">
                <div class="col-md-3 col-sm-6">
                    <div class="text-muted small">Total Benefits</div>
                    <div class="h4 text-dark font-weight-bold">${fmt(total_benefits)}</div>
                </div>
                <div class="col-md-3 col-sm-6">
                    <div class="text-muted small">Deductions</div>
                    <div class="h4 text-dark font-weight-bold">${fmt(frm.doc.deductions)}</div>
                </div>
                <div class="col-md-3 col-sm-6">
                    <div class="text-muted small">Net Amount</div>
                    <div class="h4 text-primary font-weight-bold">${fmt(frm.doc.amount)}</div>
                </div>
                <div class="col-md-3 col-sm-6">
                    <div class="text-muted small">Service Duration</div>
                    <div class="h4 text-dark font-weight-bold">${frm.doc.dos_years} Years</div>
                </div>
            </div>
        </div>
        
        <div class="row">
            <div class="col-md-6">
                <div class="frappe-card">
                    <h6 class="text-muted">Financial Details</h6>
                    <table class="table table-sm">
                        <tbody>
                            <tr>
                                <td class="text-muted">CVA Paid</td>
                                <td class="text-right font-weight-bold">${fmt(cva_paid)}</td>
                            </tr>
                            <tr>
                                <td class="text-muted">CVA Unpaid</td>
                                <td class="text-right font-weight-bold">${fmt(cva_unpaid)}</td>
                            </tr>
                            <tr>
                                <td class="text-muted">End of Service</td>
                                <td class="text-right font-weight-bold">${fmt(frm.doc.total_eos)}</td>
                            </tr>
                            <tr>
                                <td class="text-muted">Ticket Allowance</td>
                                <td class="text-right font-weight-bold">${fmt(frm.doc.ticket_allowance)}</td>
                            </tr>
                            <tr class="border-top">
                                <td class="font-weight-bold">Total</td>
                                <td class="text-right font-weight-bold text-primary">${fmt(frm.doc.amount)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            
            <div class="col-md-6">
                <div class="frappe-card">
                    <h6 class="text-muted">Service & Salary Info</h6>
                    <table class="table table-sm">
                        <tbody>
                            <tr>
                                <td class="text-muted">Basic Salary</td>
                                <td class="text-right font-weight-bold">${fmt(frm.doc.total_salary)}</td>
                            </tr>
                            <tr>
                                <td class="text-muted">Salary per Day</td>
                                <td class="text-right font-weight-bold">${fmt(frm.doc.salary_per_day)}</td>
                            </tr>
                            <tr>
                                <td class="text-muted">Service Period</td>
                                <td class="text-right font-weight-bold">${parseInt(frm.doc.years || 0)}Y ${parseInt(frm.doc.months || 0)}M ${parseInt(frm.doc.days || 0)}D</td>
                            </tr>
                            <tr>
                                <td class="text-muted">Ticket Eligible</td>
                                <td class="text-right font-weight-bold">${ticket_eligible}</td>
                            </tr>
                            <tr>
                                <td class="text-muted">PR Status</td>
                                <td class="text-right">
                                    <span class="indicator ${pr_color}">${frm.doc.pr_status}</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        
        <style>
            .frappe-card {
                background: #fff;
                padding: 15px;
                border-radius: 4px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.12);
                margin-bottom: 15px;
            }
            .frappe-card h6 {
                margin-bottom: 15px;
                font-weight: 500;
            }
            .frappe-card table {
                margin-bottom: 0;
            }
            .frappe-card .indicator {
                padding: 3px 8px;
                border-radius: 3px;
                font-size: 12px;
            }
            .frappe-card .indicator.green {
                background-color: #d4edda;
                color: #155724;
            }
            .frappe-card .indicator.orange {
                background-color: #fff3cd;
                color: #856404;
            }
        </style>
    `;
    
    frm.dashboard.add_section(html, __('EOS Calculations'));
    frm.dashboard.show();
}

function fmt(num) {
    return (num || 0).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}
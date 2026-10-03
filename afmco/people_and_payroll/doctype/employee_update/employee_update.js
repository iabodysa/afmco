// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

function addCustomButtons(frm) {
    frm.add_custom_button(__('EOS'), () => createEOSDialog(frm));
    frm.add_custom_button(__('Vacation Allowance'), () => createVacationAllowanceDialog(frm));
}

function createEOSDialog(frm) {
    let dialog = new frappe.ui.Dialog({
        title: 'Enter End of Service Reward Details',
        fields: getEOSFields(),
        primary_action_label: 'Submit',
        primary_action: (values) => submitEOSForm(values, frm)
    });
    dialog.show();
}

function getEOSFields() {
    return [
        {
            label: 'Last Working Day',
            fieldname: 'last_working_day',
            fieldtype: 'Date'
        },
        {
            label: 'End of Service Reason',
            fieldname: 'eos_reason',
            fieldtype: 'Select',
            options: ['1-End of term or mutual agreement', '2-Termination by the employer', '3-Termination by the employer under Article 80', '4-Termination due to force majeure', '5-Termination of the contract by the female employee during the first six months of marriage or during the first three months of childbirth', '6-Termination by the employee under Article 81', '7-Termination by the employee or termination of employment by the employee for reasons other than those specified in Article 81', '8-Resignation']
        },
        {
            label: 'Termination type',
            fieldname: 'termination_type',
            fieldtype: 'Select',
            options: ['Transfer of sponsorship', 'Final Exit']
        }
    ];
}

function submitEOSForm(values, frm) {
    const newRecord = frappe.model.get_new_doc('End of Service Settlement');
    newRecord.date_2 = values.last_working_day;
    newRecord.end_of_service_reason = values.eos_reason;
    newRecord.term = values.termination_type;
    newRecord.employee = frm.doc.employee;
    frappe.db.insert(newRecord).then(doc => {
        frappe.set_route('Form', doc.doctype, doc.name);
    });
}

function createVacationAllowanceDialog(frm) {
    let dialog = new frappe.ui.Dialog({
        title: 'Enter Vacation Allowance Details',
        fields: [
            {
                label: 'Vacation Start Date',
                fieldname: 'vacation_start_date',
                fieldtype: 'Date'
            },
            {
                label: 'Exit and return visa',
                fieldname: 'check1',
                fieldtype: 'Check'
            }
        ],
        primary_action_label: 'Submit',
        primary_action: (values) => submitVacationAllowanceForm(values, frm)
    });
    dialog.show();
}

function submitVacationAllowanceForm(values, frm) {
    const newRecord = frappe.model.get_new_doc('Vacation Allowance');
    newRecord.date_2 = values.vacation_start_date;
    newRecord.check1 = values.check1;
    newRecord.employee = frm.doc.employee;
    frappe.db.insert(newRecord).then(doc => {
        frappe.set_route('Form', doc.doctype, doc.name);
    });
}

function updateEmployeeDetails(frm) {
    frm.call('sync_to_employee');
}

frappe.ui.form.on('Employee Update', {
    refresh: function(frm) {
        addCustomButtons(frm);
    },
    updatebutton: function(frm) {
        updateEmployeeDetails(frm);
    }
});

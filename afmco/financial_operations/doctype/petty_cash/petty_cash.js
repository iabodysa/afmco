// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

const RETIRED_CATEGORIES = [
    'Cash payments for employees without bank accounts.',
    'Living expenses for new employees.',
    'Minor expenses.',
    'Emergency reserve.',
];

frappe.ui.form.on('Petty Cash', {
    refresh: function(frm) {
        const options = frappe.meta.get_docfield('Petty Cash', 'category').options.split('\n');
        frm.set_df_property(
            'category',
            'options',
            options.filter((option) => !RETIRED_CATEGORIES.includes(option) || option === frm.doc.category)
        );
          if (frm.doc.workflow_state === 'Document Upload') {
            frm.add_custom_button(
                frappe._('Create PR'),
                () => {
                    frm.events.createpr(frm);
                }
            ).addClass('btn-danger');
        }
    },

    createpr: function(frm) {
        try {
            const { name, bank_ac_no, employee_name, petty_cash_amount, bank_payment_date, date, jv_status, naming_series, cost_center, project, petty_cash_description,} = frm.doc;

            const expenseRequestData = {
                tax_invoice_number: name,
                bank_payment_date : frappe.datetime.nowdate(),
                date : frappe.datetime.nowdate(),
                jv_status: 'JV Not Created',
                naming_series: 'PR-.YYYY.-',
                cost_center: cost_center,
                project: cost_center,
                account_no: bank_ac_no,
                beneficiary_name: employee_name,
                amount: petty_cash_amount,
                remark: petty_cash_description,
                mode_of_payment: 'Bank Transfer',
                payment_type: 'Petty Cash'
            };

            const expenseRequest = frappe.model.get_new_doc('Payment Requisition');
            Object.assign(expenseRequest, expenseRequestData);

            frappe.set_route('Form', expenseRequest.doctype, expenseRequest.name);
        } catch (error) {
            console.error('Error in createpr function: ', error);
            frappe.msgprint(__('There was an error creating the Expense Request.'));
        }
    }
});

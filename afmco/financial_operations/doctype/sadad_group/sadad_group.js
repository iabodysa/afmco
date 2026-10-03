// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.ui.form.on('SADAD Group', {
  refresh: function(frm) {
    try {
      const buttons = [
        {
          condition: frm.doc.docstatus === 1,
          label: 'calculate Mode',
          action: () => frm.events.calculate(frm),
          className: 'btn-primary'
        },
        {
          condition: frm.doc.docstatus === 0,
          label: 'Create PR',
          action: () => frm.events.createpr(frm),
          className: 'btn-danger'
        },
        {
          condition: frm.doc.docstatus === 0,
          label: 'Get Employee',
          action: () => frm.events.gemployee(frm),
          className: 'btn-primary'
        },
        {
          condition: frm.doc.docstatus === 0,
          label: 'Export Bank CSV',
          action: () => frm.events.dowcsv(frm),
          className: 'btn-primary'
        }
      ];

      buttons.forEach(button => {
        if (button.condition) {
          frm.add_custom_button(button.label, button.action).addClass(button.className);
        }
      });
    } catch (error) {
      console.error('Error in refresh function: ', error);
    }
  },

  gemployee: function(frm) {
    frm.call('build_fee_table').then(() => frm.dirty());
  },

  calculate: function(frm) {
    try {
      const SADADCalculation = frappe.model.get_new_doc('SADAD Calculation');
      SADADCalculation.name1 = frm.doc.name;
      SADADCalculation.table12 = frm.doc.table12;
      frappe.set_route('Form', 'SADAD Calculation', SADADCalculation.name);
    } catch (error) {
      console.error('Error in calculate function: ', error);
    }
  },

  createpr: function(frm) {
    try {
      let remarks = '';
      frm.doc.table12.forEach(row => {
        remarks += `Employee: ${row.employee}\n`;
        remarks += `Employee Name: ${row.employee_name}\n`;
        remarks += `Type: ${row.type}\n`;
        remarks += `Period: ${row.period}\n`;
        remarks += `Amount: ${row.amount}\n`;
        remarks += `Cost Center: ${row.cost_center}\n`;
        remarks += '------------------------\n';
      });

      const expenseRequestData = {
        tax_invoice_number: frm.doc.name,
        account_no: 'SADAD Group',
        beneficiary_name: 'Payment of MOI - Expatriates',
        amount: frm.doc.total_amount,
        remark: remarks,
        mode_of_payment: 'SADAD Payment',
        payment_type: 'SADAD Payment'
      };

      const expenseRequest = frappe.model.get_new_doc('Payment Requisition');
      Object.keys(expenseRequestData).forEach(key => {
        expenseRequest[key] = expenseRequestData[key];
      });

      frappe.set_route('Form', expenseRequest.doctype, expenseRequest.name);
    } catch (error) {
      console.error('Error in createpr function: ', error);
    }
  },

  dowcsv: function(frm) {
    try {
      if (!frm.doc.table12 || frm.doc.table12.length === 0) {
        frappe.msgprint(__('No data to export'));
        return;
      }

      const data = frm.doc.table12.map(row => ({
        Biller: row.biller,
        Service: row.service,
        IqamaID: row.employee,
        IqamaDurationinYears: row.period,
      }));

      let csvContent = 'Biller,Service,Iqama ID,Iqama Duration in Years\n';
      data.forEach(row => {
        csvContent += `${row.Biller},${row.Service},${row.IqamaID},${row.IqamaDurationinYears}\n`;
      });

      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${frm.doc.name}-Bank.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error in dowcsv function: ', error);
    }
  }
});
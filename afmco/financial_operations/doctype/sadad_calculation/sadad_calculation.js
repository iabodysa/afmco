// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

const types = [
  'Issue or renew residence permit',
  'Transfer of sponsorship',
  'Change of profession',
  'Exit and Return Visa',
  'Extend exit and re-entry visa (1) month',
];

const typesArabic = [
  'إصدار أو تجديد تصريح الإقامة',
  'نقل الكفالة',
  'تغيير المهنة',
  'تأشيرة الخروج والعودة',
  'تمديد تأشيرة الخروج وإعادة الدخول (شهر واحد)',
];

const account_head_office = [
  '532005 - م - رسوم تغيير مهنه - AF',
  '532006 - م - رسوم جوازات - AF',
  '532007 - م - رسوم خروج وعودة - AF',
  '532011 - م - رسوم نقل كفالة - AF',
];

const account_other = [
  '512004 - م - رسوم الجوازات (تشغيل) - AF',
  '512005 - م - رسوم تغيير مهنه (تشغيل) - AF',
  '512006 - م - رسوم خروج وعودة (تشغيل) - AF',
  '512009 - م - رسوم نقل الكفالة (تشغيل) - AF',
];

const upfrontExpenses = [
  '126004 - مصروفات مقدمة رسوم جوازات - AF',
  '126006 - مصروفات مقدمة رسوم نقل كفالة - AF',
];

frappe.ui.form.on('SADAD Calculation', {
  refresh: function(frm) {
    console.log('Refresh button clicked');
    frm.add_custom_button(
      frappe._('Create JV'),
      () => {
        console.log('Create JV button clicked');
        frm.events.createjv(frm);
      }
    ).addClass('btn-primary');

    frm.add_custom_button(
      frappe._('Get Update and Sync and Calculate'),
      () => {
        frm.events.calculateyear(frm);
      }
    ).addClass('btn-danger');
  },

  createjv: function(frm) {
    console.log('Create JV function called');
    const journalEntry = frappe.model.get_new_doc('Journal Entry');
    journalEntry.cheque_no = frm.doc.name;
    journalEntry.accounts = frm.doc.table9;
    frappe.set_route('Form', 'Journal Entry', journalEntry.name);
    console.log('Create JV function completed');
  },

  calculateyear: function(frm) {
    console.log('Calculate year function called');

    Emad(frm);

    updateChildTableRows(frm);

    syncAndUpdate(frm);

    transferDataToAccounts(frm);

  },
});

function Emad(frm) {
  if (frm.doc.table12 && frm.doc.table12.length > 0) {
    let newRows = [];

    frm.doc.table12.forEach(row => {
      let newRow = {};

      Object.assign(newRow, row);

      newRow.credit = newRow.amount;
      delete newRow.amount;

      newRows.push(newRow);
    });

    newRows.forEach(newRow => {
      let addedRow = frappe.model.add_child(frm.doc, 'table12', 'table12');
      Object.assign(addedRow, newRow);
    });

    frm.refresh_field('table12');
  }
}

function syncAndUpdate(frm) {
  if (frm.doc.table12 && frm.doc.table12.length > 0) {
    const currentYear = new Date().getFullYear();

    frm.doc.table12.forEach(row => {
      if (row.year === currentYear) {
        row.account = mapAccount(row.type, true);
      } else {
        if (row.type === types[0] || row.type === types[2] || row.type === types[3] || row.type === types[4]) {
          row.account = upfrontExpenses[0];
        } else if (row.type === types[1]) {
          row.account = upfrontExpenses[1];
        }
      }
    });

    frm.refresh_field('table12');
  }
}

function mapAccount(type, isHeadOffice) {
  const officeArray = isHeadOffice ? account_head_office : account_other;
  switch (type) {
    case types[0]:
      return officeArray[isHeadOffice ? 1 : 0];
    case types[1]:
      return officeArray[isHeadOffice ? 3 : 3];
    case types[2]:
      return officeArray[isHeadOffice ? 0 : 1];
    case types[3]:
    case types[4]:
      return officeArray[isHeadOffice ? 2 : 2];
    default:
      return null;
  }
}

function transferDataToAccounts(frm) {
  frm.doc.table12.forEach(function(child12) {
    const child9 = frappe.model.add_child(frm.doc, 'table9', 'table9');
    child9.cost_center = child12.cost_center;
    child9.employee = child12.employee;
    child9.debit_in_account_currency = child12.amount;
    child9.account = child12.account;
    const index = types.indexOf(child12.type);
    const typeInArabic = index >= 0 ? typesArabic[index] : child12.type;
    child9.user_remark = typeInArabic + ' ' + child12.employee;
    child9.bank_account = 'الاهلى تشغيل - الاهلى تشغيل';
    child9.credit_in_account_currency = child12.credit;

  });

  frm.refresh_field('table9');
}

function updateChildTableRows(frm) {
  if (frm.doc.table12 && frm.doc.table12.length > 0) {
    const newRows = [];
    const currentYear = new Date().getFullYear();

    frm.doc.table12.forEach(row => {
         if (!row.amount) {
        return;
      }
      row.year = currentYear;

      if (row.period && row.period !== '') {
        let endDate = new Date(row.date);
        endDate.setMonth(endDate.getMonth() + parseInt(row.period));
        row.enddate = endDate.toISOString().split('T')[0];

        let diffDays = calculateDifferenceInDays(new Date(row.date), endDate);

        if (endDate.getFullYear() === currentYear) {
          console.log('End date is in the current year, skipping row:', row);
        } else {
          let dailyValue = row.amount / diffDays;
          let oldEndDate = endDate;
          endDate = new Date(currentYear, 11, 31);
          let newDiffDays = calculateDifferenceInDays(new Date(row.date), endDate);
          row.amount = dailyValue * newDiffDays;
          row.enddate = new Date(endDate);

          let newRow = Object.assign({}, row);
          newRow.date = new Date(currentYear + 1, 0, 1);
          newRow.enddate = oldEndDate;
          let finalDiffDays = calculateDifferenceInDays(newRow.date, oldEndDate);
          newRow.amount = dailyValue * finalDiffDays;
          newRow.year = currentYear + 1;

          newRows.push(newRow);
        }
      }
    });

    newRows.forEach(function(newRow) {
      const newRowInTable12 = frappe.model.add_child(frm.doc, 'table12', 'table12');
      newRowInTable12.employee = newRow.employee;
      newRowInTable12.type = newRow.type;
      newRowInTable12.amount = newRow.amount;
      newRowInTable12.date = newRow.date;
      newRowInTable12.enddate = newRow.enddate;
      newRowInTable12.year = newRow.year;
      newRowInTable12.account = mapAccount(newRow.type, true);
    });

    frm.refresh_field('table12');
  }
}

function calculateDifferenceInDays(date1, date2) {
  return Math.ceil((date2 - date1) / (1000 * 60 * 60 * 24));
}

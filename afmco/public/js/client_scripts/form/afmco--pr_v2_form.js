frappe.ui.form.on('PR v2', {
  onload: function(frm) {
    frappe.call({
      method: 'afmco.financial_operations.api.pr_v2.get_expense_approvers',
      type: 'GET',
    }).then(function(r) {
      const approvers = r.message || [];
      frm.set_query('assign_to_employee', function() {
        return { filters: { 'name': ['in', approvers] } };
      });
    });
  },
    refresh: function(frm) {
        if (frm.doc.docstatus === 'Document Upload') {
            frm.add_custom_button(__("Create JV"), function() {
                createJournalVoucher(frm);
            }).addClass('btn-primary');
            frm.add_custom_button(__('Download CSV'), function() {
                downloadCsvData(frm);
                
            });
        }
        if (frm.doc.workflow_state === "Financial Controller") {
            frm.set_df_property('assign_to_employee', 'hidden', false);
            
        } else {
            frm.set_df_property('assign_to_employee', 'hidden', true);  
            
        }
    }
});

function createJournalVoucher(frm) {
    const journalEntry = frappe.model.get_new_doc('Journal Entry');
    journalEntry.company = 'شركة عبدالله فهد المطيري للخدمات المساندة';
    journalEntry.expense_request_cf = frm.doc.name;
    journalEntry.posting_date = frappe.datetime.get_today();
    journalEntry.user_remark = frm.doc.remark;
    frappe.set_route('Form', 'Journal Entry', journalEntry.name);
}

function downloadCsvData(frm) {
    let entriesArray = [];
    createEntries(frm, entriesArray);
    exportToCSV(entriesArray, frm.doc.name);
}

function createEntries(frm, entriesArray) {
    let account = frm.doc.account;
    let bank_account = frm.doc.bank_account;
    let type = frm.doc.type; 
    let month = frm.doc.due_in_a_month;
    let its_group = frm.doc.its_group;
    if(its_group === 1) {
        frm.doc.group.forEach(groupEntry => {
            processEntry(frm, groupEntry, account, bank_account, type, month, entriesArray);
        });
    } else {
        processEntry(frm, frm.doc, account, bank_account, type, month, entriesArray);
    }
}

function processEntry(frm, entry, account, bank_account, type, month, entriesArray) {
    let employee = entry.employee;
    let employeeName = entry.employee_name || frm.doc.beneficiary_name; 
    let loan = entry.loan;
    let amount = entry.amount || frm.doc.amount;
    if (type === 'Accrued Expenses') {
        entriesArray.push({
            account: account,
            party_type: 'Employee',
            party: employee,
            debit: amount,
            credit: '',
            user_remark: 'Employee Name: ' + employeeName + '| ID:' + employee + '|' + account + '| Month:' + month,
            cost_center: '',
            employee: ''
        });
        entriesArray.push({
            account: bank_account,
            party_type: '',
            party: '',
            debit: '',
            credit: amount,
            user_remark: 'Employee Name: ' + employeeName + '| ID:' + employee + '|' + bank_account + '| Month:' + month,
            cost_center: '',
            employee: ''
        });
        if (loan) {
            entriesArray.push({
                account: '',
                party_type: 'Employee',
                party: employee,
                debit: '',
                credit: loan,
                user_remark: 'Proof of deduction from ' + month + ' salary',
                cost_center: '',
                employee: ''
            });
        }
    } else if (type === 'Expenses') {
        entriesArray.push({
            account: account,
            party_type: 'Employee',
            party: employee,
            debit: amount,
            credit: '',
            user_remark: frm.doc.remark,
            cost_center: '',
            employee: ''
        });
        entriesArray.push({
            account: bank_account,
            party_type: '',
            party: '',
            debit: '',
            credit: amount,
            user_remark: frm.doc.remark,
            cost_center: '',
            employee: ''
        });
    }
}

function exportToCSV(entriesArray, documentName) {
    let csvContent = 
        '"Bulk Edit Accounting Entries"\n' +
        '"Account","Account Type","Account Balance","Bank Account","Party Type","Party","Party Balance","Cost Center","EMP Cost Center","Project","Account Currency","Exchange Rate","Debit","Debit in Company Currency","Credit","Credit in Company Currency","Reference Type","Reference Name","Reference Due Date","Reference Detail No","Is Advance","User Remark","Against Account"\n' +
        '"account","account_type","balance","bank_account","party_type","party","party_balance","cost_center","employee","project","account_currency","exchange_rate","debit_in_account_currency","debit","credit_in_account_currency","credit","reference_type","reference_name","reference_due_date","reference_detail_no","is_advance","user_remark","against_account"\n' +
        '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + 
        '"If Income or Expense "' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + 
        '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + '""' + ',' + 
        '""' + ',' + '""' + ',' + '""' + ',' + '""' + '\n' +
        '"The CSV format is case sensitive"\n' +
        '"Do not edit headers which are preset in the template"\n' +
        '"------"\n';
        
    entriesArray.forEach(entry => {
        let row = [
            entry.account || "",
            entry.account_type || "",
            entry.balance || "",
            entry.bank_account || "",
            entry.party_type || "",
            entry.party || "",
            entry.party_balance || "",
            entry.cost_center || "",
            entry.employee || "",
            entry.project || "",
            entry.account_currency || "",
            entry.exchange_rate || "",
            entry.debit || "",
            entry.debit_in_account_currency || "",
            entry.credit || "",
            entry.credit_in_account_currency || "",
            entry.reference_type || "",
            entry.reference_name || "",
            entry.reference_due_date || "",
            entry.reference_detail_no || "",
            entry.is_advance || "",
            entry.user_remark || "",
            entry.against_account || ""
        ];
        csvContent += row.join(",") + "\n";
    });

    let encodedUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    let link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", documentName + ".csv");
    document.body.appendChild(link);
    link.click();
}
// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.ui.form.on('Expense Request Afmco', {
	setup: function (frm) {
		if (frm.doc.created_by == undefined) {
			frm.set_value('created_by', frappe.session.user)
		}
	},
	refresh: function (frm) {
		if (frm.doc.docstatus == 1 && (frm.doc.jv_status === 'JV Not Created' || !frm.doc.jv_status)) {
			frm.add_custom_button(__("Create JV"), function () {

			    let d = new frappe.ui.Dialog({
                    title: __("Journal Entry Details"),
                    fields: [
                        {
                            label: __("Credit Bank Account"),
                            fieldname: 'bank_account',
                            fieldtype: 'Link',
                            options: 'Account',
                            reqd: 1,
                            get_query: function() {
                                return { filters: { is_group: 0, account_type: 'Bank' } };
                            }
                        },
                        {
                            label: __("Employee Classification (for Accounting Routing)"),
                            fieldname: 'employee_type',
                            fieldtype: 'Select',
                            options: [__("Projects Employee"), __("Administration Employee")],
                            default: __("Projects Employee"),
                            reqd: 1,
                            hidden: !["EOS", "Vacation Allowance", "SADAD Payment"].includes(frm.doc.payment_type)
                        }
                    ],
                    primary_action_label: __("Create the Entry"),
                    primary_action(values) {
                        d.hide();

                        let is_admin = values.employee_type === __("Administration Employee");

                        // Fetch accounts dynamically based on selection
                        let account_numbers = [];
                        if (is_admin) {
                            account_numbers = ['531002', '531003', '531004']; // EOS, Vac, Ticket
                        } else {
                            account_numbers = ['212004', '212002', '212001']; // EOS, Vac, Ticket
                        }

                        frappe.show_alert({message: __("Preparing the entry..."), indicator: 'orange'});

                        frappe.model.with_doctype('Journal Entry', () => {
                        frappe.model.with_doctype('Journal Entry Account', () => {
                            Promise.all([
                            frappe.db.get_list('Account', {filters: {account_number: account_numbers[0]}, fields: ['name']}),
                            frappe.db.get_list('Account', {filters: {account_number: account_numbers[1]}, fields: ['name']}),
                                frappe.db.get_list('Account', {filters: {account_number: account_numbers[2]}, fields: ['name']}),
                                frappe.db.get_list('Employee', {filters: {bank_ac_no: frm.doc.account_no}, fields: ['name']}),
                                frappe.db.get_list('Account', {
                                    filters: {account_number: ['in', ['532005', '532006', '532007', '532011', '512004', '512005', '512006', '512009', '126004', '126006']]},
                                    fields: ['name', 'account_number']
                                })
                            ]).then(results => {
                                let sadad_accounts = {};
                                if (results[4]) {
                                    results[4].forEach(acc => {
                                        sadad_accounts[acc.account_number] = acc.name;
                                    });
                                }
                                let eos_acc = results[0] && results[0].length > 0 ? results[0][0].name : "";
                            let vac_acc = results[1] && results[1].length > 0 ? results[1][0].name : "";
                            let ticket_acc = results[2] && results[2].length > 0 ? results[2][0].name : "";
                            let emp = results[3] && results[3].length > 0 ? results[3][0] : null;
                            let employee_id = emp ? emp.name : "";

                            const remark = frm.doc.remark || "";
                            // Fallback parsing for employee ID
                            let empMatch = remark.match(/Employee ID:\s*(\d+)/i) || remark.match(/Employee:\s*(\d+)/i);
                            if (empMatch) employee_id = empMatch[1];

                            let journal_entry = frappe.model.get_new_doc("Journal Entry");
							journal_entry.expense_request_cf = frm.doc.name;
							journal_entry.user_remark = remark || ("Expense Request: " + frm.doc.name);

							let add_row = (account, debit, credit, party_type, party, copy_cost_center = false) => {
                                let row = frappe.model.get_new_doc("Journal Entry Account", journal_entry, "accounts");
                                if (!journal_entry.accounts) journal_entry.accounts = [];
                                journal_entry.accounts.push(row);
                                if (account) row.account = account;
                                row.debit_in_account_currency = debit;
                                row.credit_in_account_currency = credit;
                                if (party_type && party) {
                                    row.party_type = party_type;
                                    row.party = party;
                                }
                                if (copy_cost_center) {
                                    if (frm.doc.cost_center) row.cost_center = frm.doc.cost_center;
                                    if (frm.doc.project) row.project = frm.doc.project;
                                }
                                return row;
                            };

                            try {
								if (frm.doc.payment_type === "EOS") {
									let ticket = parseFloat((remark.match(/Ticket Allowance:\s*([\d\.]+)/i) || [0,0])[1]);
									let vacation = parseFloat((remark.match(/Total Vacation Allowance:\s*([\d\.]+)/i) || remark.match(/Vacation Allowance:\s*([\d\.]+)/i) || [0,0])[1]);
									let eos = parseFloat((remark.match(/EOS:\s*([\d\.]+)/i) || [0,0])[1]);

									if(ticket > 0) add_row(ticket_acc, ticket, 0, null, null, is_admin);
									if(vacation > 0) add_row(vac_acc, vacation, 0, null, null, is_admin);
									if(eos > 0) add_row(eos_acc, eos, 0, null, null, is_admin);

									add_row(values.bank_account, 0, frm.doc.amount || 0, null, null, false);

								} else if (frm.doc.payment_type === "Vacation Allowance") {
									let total_ticket = parseFloat((remark.match(/Total Ticket\|\s*([\d\.]+)/i) || remark.match(/Ticket Allowance:\s*([\d\.]+)/i) || [0,0])[1]);
									let total_amount = frm.doc.amount || 0;
									let ticket = Math.min(total_ticket, total_amount);
									let vacation = total_amount - ticket;

									if(ticket > 0) add_row(ticket_acc, ticket, 0, null, null, is_admin);
									if(vacation > 0) add_row(vac_acc, vacation, 0, null, null, is_admin);

									add_row(values.bank_account, 0, total_amount, null, null, false);

								} else if (frm.doc.payment_type === "SADAD Payment") {
									let start_date = frm.doc.bank_payment_date || frm.doc.posting_date;
									if (!start_date) {
										frappe.msgprint(__("Please make sure a date (Bank Payment Date or Posting Date) is set to calculate the split across years."));
										throw new Error("Missing date");
									}

									let currentYear = new Date(start_date).getFullYear();
									let blocks = remark.split('------------------------');

									blocks.forEach(block => {
										if (!block.trim()) return;

										let emp_match = block.match(/Employee:\s*([^\n]+)/i);
										let type_match = block.match(/Type:\s*([^\n]+)/i);
										let period_match = block.match(/Period:\s*([\d]+)/i);
										let amt_match = block.match(/Amount:\s*([\d\.]+)/i);

										if (emp_match && type_match && amt_match) {
											let employee_id = emp_match[1].trim();
											let type = type_match[1].trim();
											let period = period_match ? parseInt(period_match[1]) : 0;
											let amount = parseFloat(amt_match[1]);

                                            let get_expense_acc_no = (t, is_admin) => {
                                              const ho = ['532005', '532006', '532007', '532011']; // 0:Prof, 1:Passport, 2:Exit, 3:Sponsor
                                              const oth = ['512004', '512005', '512006', '512009']; // 0:Passport, 1:Prof, 2:Exit, 3:Sponsor

                                              if (t === 'Issue or renew residence permit') return is_admin ? ho[1] : oth[0];
                                              if (t === 'Transfer of sponsorship') return is_admin ? ho[3] : oth[3];
                                              if (t === 'Change of profession') return is_admin ? ho[0] : oth[1];
                                              if (t === 'Exit and Return Visa' || t === 'Extend exit and re-entry visa (1) month') return is_admin ? ho[2] : oth[2];
                                              return null;
                                            };

                                            let get_prepaid_acc_no = (t) => {
                                                if (t === 'Transfer of sponsorship') return '126006';
                                                return '126004';
                                            };

                                            let exp_acc_no = get_expense_acc_no(type, is_admin);
                                            let prep_acc_no = get_prepaid_acc_no(type);

                                            let expense_acc = exp_acc_no ? sadad_accounts[exp_acc_no] : "";
                                            let prepaid_acc = prep_acc_no ? sadad_accounts[prep_acc_no] : "";

                                            if (period > 0) {
                                                let startDate = new Date(start_date);
                                                let endDate = new Date(start_date);
                                                endDate.setMonth(endDate.getMonth() + period);

                                                let diffDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));

                                                if (endDate.getFullYear() === currentYear) {
                                                    add_row(expense_acc, amount, 0, null, null, is_admin);
                                                } else {
                                                let currentMonth = startDate.getMonth(); // 0-11
                                                let currentYearFraction = (12 - currentMonth) / 12;

                                                let currentYearAmount = amount * currentYearFraction;
                                                let nextYearAmount = amount - currentYearAmount;

                                                if (currentYearAmount > 0) add_row(expense_acc, currentYearAmount, 0, null, null, is_admin);
                                                if (nextYearAmount > 0) add_row(prepaid_acc, nextYearAmount, 0, null, null, is_admin);
                                                }
                                            } else {
                                                add_row(expense_acc, amount, 0, null, null, is_admin);
                                            }
										}
									});

									add_row(values.bank_account, 0, frm.doc.amount || 0, null, null, false);

								} else {
									add_row("", frm.doc.amount || 0, 0, null, null, true);
									add_row(values.bank_account, 0, frm.doc.amount || 0, null, null, false);
								}
							} catch (e) {
								console.error("Error creating rows:", e);
								if (journal_entry.accounts) journal_entry.accounts = [];
								add_row("", frm.doc.amount || 0, 0, null, null, true);
								add_row(values.bank_account, 0, frm.doc.amount || 0, null, null, false);
							}

							frappe.set_route("Form", journal_entry.doctype, journal_entry.name);
                        }).catch(e => {
                            console.error("Fetch failed:", e);
                            frappe.msgprint(__("An error occurred while fetching the accounts. A preliminary entry has been created."));
                            let journal_entry = frappe.model.get_new_doc("Journal Entry");
							journal_entry.expense_request_cf = frm.doc.name;
							if (!journal_entry.accounts) journal_entry.accounts = [];

							let r1 = frappe.model.get_new_doc("Journal Entry Account", journal_entry, "accounts");
							journal_entry.accounts.push(r1);
							r1.debit_in_account_currency = frm.doc.amount || 0;
							if (frm.doc.cost_center) r1.cost_center = frm.doc.cost_center;

							let r2 = frappe.model.get_new_doc("Journal Entry Account", journal_entry, "accounts");
							journal_entry.accounts.push(r2);
							r2.credit_in_account_currency = frm.doc.amount || 0;
							r2.account = values.bank_account;
							frappe.set_route("Form", journal_entry.doctype, journal_entry.name);
                        });
                        });
                        });
                    }
                });

                // Pre-fetch default bank account '122001' before showing the dialog
                frappe.db.get_list('Account', {filters: {account_number: '122001'}, fields: ['name']}).then(res => {
                    if (res && res.length > 0) {
                        d.set_value('bank_account', res[0].name);
                    }
                    d.show();
                });

			}).addClass('btn-primary');
		}
	}
});
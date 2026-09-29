const translations={
    slp: __('Show List of Qiwa Payment Number', null, 'iQama Renewal Payment Management'),
    cpr: __('Create Payment Request', null, 'iQama Renewal Payment Management'),
    dbf: __('Download Bank File', null, 'iQama Renewal Payment Management'),
    sri: __('Show Residency Renewal Requests with Renewal Issues', null, 'iQama Renewal Payment Management'),
    smb: __('Show Muqeem Balance', null, 'iQama Renewal Payment Management'),
    rje: __('Record Journal Entries', null, 'iQama Renewal Payment Management'),
    exv: __('Export CSV', null, 'iQama Renewal Payment Management'),
    scs: __('Record SADAD Number', null, 'iQama Renewal Payment Management'),
    prc: __('Payment Request Created', null, 'iQama Renewal Payment Management'),
    emg: __('Error creating PR for item:', null, 'iQama Renewal Payment Management') + ' ',
    nod: __('No data matching the criteria to process', null, 'iQama Renewal Payment Management'),
    err: __('Errors occurred', null, 'iQama Renewal Payment Management'),
    sav: __('Save Changes', null, 'iQama Renewal Payment Management'),
    itm: __('Item', null, 'iQama Renewal Payment Management'),
    scs_err: __('Please enter the SADAD number before updating.', null, 'iQama Renewal Payment Management'),
    sel: __('Please select at least one row.', null, 'iQama Renewal Payment Management'),
    nr: __('No records found.', null, 'iQama Renewal Payment Management')
};

frappe.ui.form.on('iQama Renewal Payment Management', {
	refresh: function(frm) {
		if (frm.doc.qiwa === 1 && frm.doc.sadad_invoice_number) {
			sadad(frm);
		}
		if (frm.doc.qiwa === 1) {
			save_issue_changes(frm);
		}
		frm.add_custom_button(translate('slp'), function() {
			reset_values(frm);
			frm.set_value('qiwa', 1);
			save_issue_changes(frm);
			frm.refresh();
		}, 'Show');
		frm.add_custom_button(translate('cpr'), function() {
			reset_values(frm);
			frm.set_value('pr2', 1);
			frm.refresh();
		}, 'Show');
		frm.add_custom_button(translate('dbf'), function() {
			reset_values(frm);
			frm.set_value('pr', 1);
			frm.refresh();
		}, 'Show');
		frm.add_custom_button(translate('sri'), function() {
			reset_values(frm);
			frm.set_value('issue', 1);
			fetch_and_set_queries_issue(frm);
			frm.refresh();
		}, 'Show');
		frm.add_custom_button(translate('smb'), function() {
			reset_values(frm);
			frm.set_value('muqeem_balance', 1);
			frm.refresh();
		}, 'Show');
		frm.add_custom_button(translate('rje'), function() {
			reset_values(frm);
			frm.set_value('jv', 1);
			fetch_and_set_jv_options(frm);
			frm.refresh();
		}, 'Show');
	},
	qiwa: function(frm) {
		frm.refresh();
		fetch_and_set_corporation_options(frm);
		save_issue_changes(frm);
	},
	pr2: function(frm) {
		frm.refresh();
	},
	pr: function(frm) {
		frm.refresh();
		create_csv_button(frm);
	},
	payment_request_number: function(frm) {
		if (frm.doc.pr == 1) {
			create_csv_button(frm);
		}
		if (frm.doc.jv == 1) {
			create_jv_button(frm);
		}
	},
	onload: function(frm) {
		reset_values(frm);
		fetchAndDisplayData();
	},
	month: function(frm) {
		if (frm.doc.month) {
			fetch_and_fill_child_table(frm);
			update_corporation_options(frm);
		}
	},
	corporation: function(frm) {
		if (frm.doc.month) {
			fetch_and_fill_child_table(frm);
		}
	},
	payment_type: function(frm) {
		create_pr_button(frm);
	},
	sadad_invoice_number: function(frm) {
		if (frm.doc.sadad_invoice_number) {
			sadad(frm);
		}
	},
	dowcsv: function(frm) {
		try {
			const filters_sadad_invoice = [
				['status', '=', 'Awaiting Renewal'],
				['payment_request_doc_number_sadad_invoice', '=', frm.doc.payment_request_number]
			];
			const filters_residency_renewal = [
				['status', '=', 'Awaiting Renewal'],
				['payment_request_doc_number_residency_renewal', '=', frm.doc.payment_request_number]
			];
			const fields_sadad_invoice = ['employee', 'renewal_period', 'sadad_invoice_number'];
			const fields_residency_renewal = ['employee', 'renewal_period'];
			frappe.call({
				method: 'frappe.client.get_list',
				args: {
					doctype: 'Iqama Renewal Fee Tracking',
					filters: filters_sadad_invoice,
					fields: fields_sadad_invoice,
					limit_page_length: false
				},
				callback: function(r) {
					if (r.message && r.message.length > 0) {
						let csvContent = 'Biller,Invoice Number\n';
						const uniqueInvoices = [...new Set(r.message.map(row => row.sadad_invoice_number))];
						uniqueInvoices.forEach(invoice => {
							csvContent += `050,${invoice}\n`;
						});
						const blob = new Blob([csvContent], {
							type: 'text/csv'
						});
						const url = URL.createObjectURL(blob);
						const a = document.createElement('a');
						a.href = url;
						a.download = `${r.message.length}-${frm.doc.payment_request_number}-Sadad_Invoice-Bank.csv`;
						document.body.appendChild(a);
						a.click();
						document.body.removeChild(a);
					} else {
						frappe.call({
							method: 'frappe.client.get_list',
							args: {
								doctype: 'Iqama Renewal Fee Tracking',
								filters: filters_residency_renewal,
								fields: fields_residency_renewal,
								limit_page_length: false
							},
							callback: function(r) {
								if (r.message && r.message.length > 0) {
									let csvContent = 'Biller,Service,Iqama ID,renewal_period\n';
									r.message.forEach(row => {
										csvContent += `90,03,${row.employee},${row.renewal_period}\n`;
									});
									const blob = new Blob([csvContent], {
										type: 'text/csv'
									});
									const url = URL.createObjectURL(blob);
									const a = document.createElement('a');
									a.href = url;
									a.download = `${r.message.length}-${frm.doc.payment_request_number}-Residency-Renewal-Bank.csv`;
									document.body.appendChild(a);
									a.click();
									document.body.removeChild(a);
								} else {
									frappe.msgprint(__('No data matching the criteria to export'));
								}
							}
						});
					}
				}
			});
		} catch (error) {
			console.error('Error in dowcsv function:', error);
		}
	},
	jv: function(frm) {
		create_jv_button(frm);
		fetch_and_set_jv_options(frm);
	},
});

function create_jv_button(frm) {
	frm.add_custom_button(translate('rje'), function() {
		create_journal_entries(frm);
	});
}

function create_csv_button(frm) {
	frm.add_custom_button(translate('exv'), function() {
		frm.trigger('dowcsv');
	}).addClass('btn-primary');
	fetch_and_set_pr_options(frm);
}

function translate(code) {
	return translations[code] || code;
}

function reset_values(frm) {
	frm.set_value('qiwa', 0);
	frm.set_value('pr', 0);
	frm.set_value('pr2', 0);
	frm.set_value('issue', 0);
	frm.set_value('muqeem_balance', 0);
	frm.set_value('jv', 0);
}

function create_pr_button(frm) {
	fetch_and_fill_payment_request_iqama_list(frm).then(function() {
		frm.add_custom_button(translate('cpr'), function() {
			createPaymentRequest(frm);
		});
		calculate_total(frm);
	}).catch(function(error) {
		console.error("Error fetching data:", error);
	});
}

function sadad(frm) {
	frm.add_custom_button(translate('scs'), function() {
		if (!frm.doc.sadad_invoice_number) {
			frappe.msgprint(translate('scs_err'));
			return;
		}
		const selected_rows = frm.fields_dict.payment_details.grid.get_selected_children();
		const sadad_invoice_number = frm.doc.sadad_invoice_number;
		if (selected_rows.length === 0) {
			frappe.msgprint(translate('sel'));
			return;
		}
		selected_rows.forEach(function(row) {
			frappe.call({
				method: 'frappe.client.set_value',
				args: {
					doctype: 'Iqama Renewal Fee Tracking',
					name: row.name1,
					fieldname: {
						sadad_invoice_number: sadad_invoice_number,
						renewal_period: parseInt(row.renewal_period, 10),
						traffic_violations: row.traffic_violations,
						issue_in_renewal: row.issue_in_renewal,
						dependent_fees: row.dependent_fees,
						two_year_plan: row.two_year_plan,
						status: 'Awaiting Payment',
						sadad_invoice_creation_date: frappe.datetime.now_datetime(),
						created_by_sadad_invoice: frappe.session.user,
					},
				},
			});
		});
		frm.set_value('sadad_invoice_number', '');
		frm.set_value('payment_details', '');
		fetch_and_set_queries(frm);
		frm.refresh();
	}).addClass('btn-danger');
}

function save_issue_changes(frm) {
	frm.add_custom_button(translate('sav'), function() {
		const selected_rows = frm.fields_dict.payment_details.grid.get_selected_children();
		if (selected_rows.length === 0) {
			frappe.msgprint(translate('sel'));
			return;
		}
		selected_rows.forEach(function(row) {
			frappe.call({
				method: 'frappe.client.set_value',
				args: {
					doctype: 'Iqama Renewal Fee Tracking',
					name: row.name1,
					fieldname: {
						traffic_violations: row.traffic_violations,
						issue_in_renewal: row.issue_in_renewal,
						dependent_fees: row.dependent_fees,
						two_year_plan: row.two_year_plan,
						renewal_expiration_violation_on_employee: row.renewal_expiration_violation_on_employee,
						status: 'Issue Preventing Renewal',
						sadad_invoice_creation_date: frappe.datetime.now_datetime(),
						created_by_sadad_invoice: frappe.session.user,
					},
				},
				callback: function() {
					frappe.call({
						method: 'frappe.client.save',
						args: {
							doc: {
								doctype: 'Iqama Renewal Fee Tracking',
								name: row.name1,
							},
						},
					});
				},
			});
		});
		frm.set_value('payment_details', '');
		fetch_and_set_queries(frm);
	}).addClass('btn-danger');
}

function fetch_and_set_corporation_options(frm) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			limit_page_length: false,
			filters: [
				['status', '=', 'Waiting Sadad']
			],
			fields: ['corporation'],
		},
		callback: function(r) {
			if (r.message && r.message.length > 0) {
				let corporations = Array.from(new Set(r.message.map(d => d.corporation)));
				frm.set_df_property('corporation', 'options', corporations.join('\n'));
			} else {
				frm.set_df_property('corporation', 'options', '');
			}
		},
	});
}

function fetch_and_set_pr_options(frm) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			filters: [
				['status', '=', 'Awaiting Renewal']
			],
			limit_page_length: false,
			fields: ['payment_request_doc_number_residency_renewal', 'payment_request_doc_number_sadad_invoice'],
		},
		callback: function(r) {
			if (r.message) {
				let paymentRequestNumbers = new Set();
				r.message.forEach(d => {
					if (d.payment_request_doc_number_residency_renewal) {
						paymentRequestNumbers.add(d.payment_request_doc_number_residency_renewal);
					}
					if (d.payment_request_doc_number_sadad_invoice) {
						paymentRequestNumbers.add(d.payment_request_doc_number_sadad_invoice);
					}
				});
				frm.set_query('payment_request_number', function() {
					return {
						filters: [
							['name', 'in', Array.from(paymentRequestNumbers)]
						],
					};
				});
			}
		},
	});
}

function fetch_and_fill_child_table(frm) {
	let filters = [
		['status', '=', 'Waiting Sadad']
	];
	if (frm.doc.month) {
		filters.push(['iqama_expiration_date', '>=',
			get_start_of_month(frm.doc.month),
		]);
		filters.push(['iqama_expiration_date', '<=',
			get_end_of_month(frm.doc.month),
		]);
	}
	if (frm.doc.corporation) {
		filters.push(['corporation', '=', frm.doc.corporation]);
	}
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			limit_page_length: false,
			filters: filters,
			fields: ['employee', 'sadad_invoice_number', 'renewal_period', 'traffic_violations', 'issue_in_renewal', 'medical_insurance_issue', 'dependent_fees', 'two_year_plan', 'renewal_expiration_violation_on_employee', 'name'],
		},
		callback: function(r) {
			if (r.message) {
				frm.clear_table('payment_details');
				r.message.forEach(function(d) {
					frm.add_child('payment_details', {
						employee: d.employee,
						sadad_invoice_number: d.sadad_invoice_number,
						renewal_period: d.renewal_period,
						traffic_violations: d.traffic_violations,
						issue_in_renewal: d.issue_in_renewal,
						dependent_fees: d.dependent_fees,
						two_year_plan: d.two_year_plan,
						renewal_expiration_violation_on_employee: d.renewal_expiration_violation_on_employee,
						name1: d.name,
						medical_insurance_issue: d.medical_insurance_issue
					});
				});
				frm.refresh_field('payment_details');
			}
		},
	});
}

function fetch_and_fill_payment_request_iqama_list(frm) {
	return new Promise(function(resolve, reject) {
		let filters = [
			['status', '=', 'Awaiting Payment'],
			['issue_in_renewal', '=', 0],
			['traffic_violations', '=', 0],
			['two_year_plan', '=', 0],
			['medical_insurance_issue', '=', 0],
			['dependent_fees', '=', 0]
		];
		if (frm.doc.payment_type === 'PR Created for Work Cards') {
			filters.push(['payment_request_doc_number_sadad_invoice', '=', '']);
		} else if (frm.doc.payment_type === 'PR Created for Iqama Renewal') {
			filters.push(['payment_request_doc_number_residency_renewal', '=', '']);
		}
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Iqama Renewal Fee Tracking',
				filters: filters,
				limit_page_length: false,
				fields: ['employee', 'employee_name', 'renewal_period', 'sadad_invoice_number', 'sadad_invoice_amount', 'renewal_fee_amount', 'iqama_expiration_date', 'name'],
			},
			callback: function(r) {
				if (r.message) {
					frm.clear_table('payment_request_iqama_list');
					let insertedRecords = [];
					let errors = [];
					r.message.forEach(function(d) {
						try {
							let row = frm.add_child('payment_request_iqama_list', {
								employee: d.employee,
								employee_name: d.employee_name,
								renewal_period: d.renewal_period,
								sadad_invoice_number: d.sadad_invoice_number,
								sadad_invoice_amount: d.sadad_invoice_amount,
								renewal_fee_amount: d.renewal_fee_amount,
								iqama_expiration_date: d.iqama_expiration_date,
								name1: d.name,
							});
							insertedRecords.push(d.name);
						} catch (error) {
							errors.push(`Error inserting record for ${d.employee}: ${error.message}`);
						}
					});
					frm.refresh_field('payment_request_iqama_list');
					if (errors.length > 0) {
						frappe.msgprint(`${translate('err')}\n${errors.join('\n')}`);
					}
					resolve();
				} else {
					frappe.msgprint(translate('nr'));
					resolve();
				}
			},
			error: function(error) {
				reject(error);
			}
		});
	});
}

function update_corporation_options(frm) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			limit_page_length: false,
			filters: [
				['iqama_expiration_date', '>=', get_start_of_month(frm.doc.month)],
				['iqama_expiration_date', '<=', get_end_of_month(frm.doc.month)],
				['status', '=', 'Waiting Sadad']
			],
			fields: ['corporation'],
		},
		callback: function(r) {
			if (r.message) {
				let corporations = Array.from(new Set(r.message.map(d => d.corporation)));
				frm.set_df_property('corporation', 'options', corporations.join('\n'));
			} else {
				frm.set_df_property('corporation', 'options', '');
			}
		},
	});
}

function get_start_of_month(month) {
	let monthIndex = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', ].indexOf(month);
	let year = frappe.datetime.get_today().split('-')[0];
	return `${year}-${('0' + (monthIndex + 1)).slice(-2)}-01`;
}

function get_end_of_month(month) {
	let monthIndex = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December', ].indexOf(month);
	let year = frappe.datetime.get_today().split('-')[0];
	let lastDay = new Date(year, monthIndex + 1, 0).getDate();
	return `${year}-${('0' + (monthIndex + 1)).slice(-2)}-${lastDay}`;
}

function fetch_and_set_queries(frm) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			limit_page_length: false,
			filters: [
				['status', '=', 'Waiting Sadad'],
				frm.doc.month ? ['iqama_expiration_date', '>=',
					get_start_of_month(frm.doc.month)
				] : null,
				frm.doc.month ? ['iqama_expiration_date', '<=',
					get_end_of_month(frm.doc.month)
				] : null,
				frm.doc.corporation ? ['corporation', '=', frm.doc.corporation] : null,
			].filter(Boolean),
			fields: ['employee', 'medical_insurance_issue', 'traffic_violations', 'issue_in_renewal', 'dependent_fees', 'two_year_plan', 'renewal_expiration_violation_on_employee', 'renewal_period', 'sadad_invoice_number', 'name']
		},
		callback: function(r) {
			if (r.message) {
				frm.clear_table('payment_details');
				r.message.forEach(function(d) {
					frm.add_child('payment_details', {
						employee: d.employee,
						medical_insurance_issue: d.medical_insurance_issue,
						traffic_violations: d.traffic_violations,
						issue_in_renewal: d.issue_in_renewal,
						dependent_fees: d.dependent_fees,
						two_year_plan: d.two_year_plan,
						renewal_expiration_violation_on_employee: d.renewal_expiration_violation_on_employee,
						renewal_period: d.renewal_period,
						sadad_invoice_number: d.sadad_invoice_number,
						name1: d.name
					});
				});
				frm.refresh_field('payment_details');
			}
		},
	});
}

function fetch_and_set_queries_issue(frm) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			limit_page_length: false,
			filters: [
				['status', '=', 'Issue Preventing Renewal']
			],
			fields: ['employee', 'sadad_invoice_number', 'renewal_period', 'traffic_violations', 'issue_in_renewal', 'dependent_fees', 'two_year_plan', 'renewal_expiration_violation_on_employee', 'name', ],
		},
		callback: function(r) {
			if (r.message) {
				frm.clear_table('payment_details');
				r.message.forEach(function(d) {
					frm.add_child('payment_details', {
						employee: d.employee,
						sadad_invoice_number: d.sadad_invoice_number,
						renewal_period: d.renewal_period,
						traffic_violations: d.traffic_violations,
						issue_in_renewal: d.issue_in_renewal,
						dependent_fees: d.dependent_fees,
						two_year_plan: d.two_year_plan,
						renewal_expiration_violation_on_employee: d.renewal_expiration_violation_on_employee,
						name1: d.name,
					});
				});
				frm.refresh_field('payment_details');
			}
		},
	});
}

function calculate_total(frm, cdt, cdn) {
	let total_renewal_fee = 0;
	let total_sadad_invoice = 0;
	if (!frm.doc.payment_request_iqama_list) {
		return;
	}
	frm.doc.payment_request_iqama_list.forEach((row, index) => {
		if (row.renewal_fee_amount) {
			let renewal_fee_amount = parseFloat(row.renewal_fee_amount) || 0;
			total_renewal_fee += renewal_fee_amount;
		}
		if (row.sadad_invoice_amount) {
			let sadad_invoice_amount = parseFloat(row.sadad_invoice_amount) || 0;
			total_sadad_invoice += sadad_invoice_amount;
		}
	});
	frm.set_value('total_renewal_fee', total_renewal_fee);
	frm.set_value('total_sadad_invoice', total_sadad_invoice);
	frm.refresh_field('total_renewal_fee');
	frm.refresh_field('total_sadad_invoice');
}
async function createPaymentRequest(frm) {
	let getCurrentDate = () => frappe.datetime.nowdate();
	let getCurrentUser = () => frappe.session.user;
	let sadad_invoices = '';
	frm.errorList = [];
	let successList = [];
	let remarks = '';
	let total_renewal_fee = 0;
	let total_sadad_invoice = 0;
	frm.doc.payment_request_iqama_list.forEach(row => {
		if (row.renewal_fee_amount) {
			total_renewal_fee += parseFloat(row.renewal_fee_amount) || 0;
		}
		if (row.sadad_invoice_amount) {
			total_sadad_invoice += parseFloat(row.sadad_invoice_amount) || 0;
		}
	});
	let total_amount = frm.doc.payment_type === 'PR Created for Work Cards' ? total_sadad_invoice : total_renewal_fee;
	try {
		frm.doc.payment_request_iqama_list.forEach(row => {
			if (row.employee) remarks += `iQama: ${row.employee}\n`;
			if (row.employee_name) remarks += `Name: ${row.employee_name}\n`;
			if (row.renewal_period) remarks += `Renewal Period: ${row.renewal_period}\n`;
			if (frm.doc.payment_type === 'PR Created for Work Cards' && row.sadad_invoice_number) {
				remarks += `Invoice Number: ${row.sadad_invoice_number}\n`;
			}
			remarks += '------------------------\n';
			successList.push(row.name1);
		});
		let account_no = '';
		if (frm.doc.payment_type === 'PR Created for Work Cards') {
			account_no = '050'
		} else if (frm.doc.payment_type === 'PR Created for Iqama Renewal') {
			account_no = 'Payment of MOI - Expatriates for multiple Iqamas';
		}
		let expenseRequestData = {
			beneficiary_name: frm.doc.payment_type === 'PR Created for Work Cards' ? 'وزارة الموارد البشرية (مكتب العمل)' : 'خدمات المقيمين وزارة الداخلية',
			amount: total_amount,
			remark: remarks,
			mode_of_payment: 'SADAD Payment',
			payment_type: 'SADAD Payment',
			jv_status: 'JV Not Created',
			naming_series: 'PR-.YYYY.-',
			date: getCurrentDate(),
			bank_payment_date: getCurrentDate(),
			project: 'الادارة رئيسي - Head Office - AF',
			cost_center: 'الادارة رئيسي - Head Office - AF',
			bank_account: '122001 - البنك الاهلي - تشغيل - National Bank - running - AF',
			payment_approver: 'Human Resources - الموارد البشرية',
			created_by: getCurrentUser(),
			account_no: account_no
		};
		let expenseRequest = await frappe.db.insert({
			doctype: 'Expense Request Afmco',
			...expenseRequestData
		});
		for (const name of successList) {
			try {
				let updates = {};
				if (frm.doc.payment_type === 'PR Created for Work Cards') {
					updates = {
						'payment_request_doc_number_sadad_invoice': expenseRequest.name,
						'payment_request_creation_date_sadad_invoice': getCurrentDate(),
						'payment_request_creation_user_sadad_invoice': getCurrentUser(),
						'status': 'Awaiting Payment'
					};
				} else if (frm.doc.payment_type === 'PR Created for Iqama Renewal') {
					updates = {
						'payment_request_doc_number_residency_renewal': expenseRequest.name,
						'payment_request_creation_date_residency_renewal': getCurrentDate(),
						'payment_request_creation_user_residency_renewal': getCurrentUser(),
						'status': 'Awaiting Renewal'
					};
				}
				await frappe.db.set_value('Iqama Renewal Fee Tracking', name, updates);
			} catch (error) {
				frm.errorList.push({
					item: name,
					error: error.message
				});
				console.error(translate('emg'), error);
			}
		}
		if (frm.errorList.length > 0) {
			frappe.msgprint(`${translate('err')}\n${frm.errorList.map(e => `${translate('itm')}: ${e.item}, ${translate('emg')}: ${e.error}`).join('\n')}`);
		} else {
			frappe.msgprint(translate('prc'));
		}
	} catch (error) {
		frappe.msgprint(translate('emg') + ' ' + error.message);
		console.error(translate('emg'), error);
	}
	fetch_and_fill_payment_request_iqama_list(frm);
}

function create_journal_entries(frm) {
	try {
		const filters_sadad_invoice = [
			['jv_created_for_sadad_invoice', '=', 0],
			['payment_request_doc_number_sadad_invoice', '=', frm.doc.payment_request_number]
		];
		const filters_residency_renewal = [
			['jv_created_for_renewal_fees', '=', 0],
			['payment_request_doc_number_residency_renewal', '=', frm.doc.payment_request_number]
		];
		const fields_sadad_invoice = ['name', 'employee', 'cost_center', 'sadad_invoice_number', 'sadad_invoice_amount', 'sadad_invoice_amount_for_current_year', 'sadad_invoice_amount_for_advance_payments'];
		const fields_residency_renewal = ['name', 'employee', 'cost_center', 'renewal_fee_amount', 'renewal_fee_amount_for_current_year', 'renewal_fee_amount_for_advance_payments'];
		frappe.call({
			method: 'frappe.client.get_list',
			args: {
				doctype: 'Iqama Renewal Fee Tracking',
				filters: filters_sadad_invoice,
				fields: fields_sadad_invoice,
				limit_page_length: false
			},
			callback: function(r) {
				if (r.message && r.message.length > 0) {
					let journal_entry = frappe.model.get_new_doc('Journal Entry');
					journal_entry.voucher_type = 'Journal Entry';
					journal_entry.company = 'شركة عبدالله فهد المطيري للخدمات المساندة';
					journal_entry.posting_date = frappe.datetime.nowdate();
					journal_entry.expense_request_cf = frm.doc.payment_request_number;
					r.message.forEach(row => {
						let remarks = `Type: Sadad Invoice\nهوية الموظف | ID: ${row.employee}\nالنوع: Sadad Invoice\n`;
						remarks += `Invoice Number: ${row.sadad_invoice_number}\n`;
						let row_debit_current = frappe.model.add_child(journal_entry, 'Journal Entry Account', 'accounts');
						row_debit_current.account = '512008 - م - رسوم مكتب عمل ( تشغيل ) - M - Office fees (operation) - AF';
						row_debit_current.debit = parseFloat(row.sadad_invoice_amount_for_current_year);
						row_debit_current.debit_in_account_currency = parseFloat(row.sadad_invoice_amount_for_current_year);
						row_debit_current.account_type = 'Expense Account';
						row_debit_current.cost_center = row.cost_center;
						row_debit_current.employee = row.employee;
						row_debit_current.user_remark = remarks;
						if (row.sadad_invoice_amount_for_advance_payments > 0) {
							let row_debit_advance = frappe.model.add_child(journal_entry, 'Journal Entry Account', 'accounts');
							row_debit_advance.account = '126005 - مصروفات مقدمة رسوم مكتب عمل - Upfront expenses, office fees - AF';
							row_debit_advance.debit = parseFloat(row.sadad_invoice_amount_for_advance_payments);
							row_debit_advance.debit_in_account_currency = parseFloat(row.sadad_invoice_amount_for_advance_payments);
							row_debit_advance.account_type = 'Expense Account';
							row_debit_advance.cost_center = row.cost_center;
							row_debit_advance.employee = row.employee;
							row_debit_advance.user_remark = remarks;
						}
						let row_credit = frappe.model.add_child(journal_entry, 'Journal Entry Account', 'accounts');
						row_credit.account = '122001 - البنك الاهلي - تشغيل - National Bank - running - AF';
						row_credit.credit = parseFloat(row.sadad_invoice_amount);
						row_credit.credit_in_account_currency = parseFloat(row.sadad_invoice_amount);
						row_credit.user_remark = remarks;
						row_credit.account_type = 'Bank';
						row_credit.bank_account = "الاهلى تشغيل - الاهلى تشغيل";
						row_credit.party_type = 'Employee';
						row_credit.party = row.employee;
						frappe.call({
							method: 'frappe.client.set_value',
							args: {
								doctype: 'Iqama Renewal Fee Tracking',
								name: row.name,
								fieldname: 'jv_created_for_sadad_invoice',
								value: 1
							}
						});
					});
					frappe.db.insert(journal_entry).then((doc) => {}).catch((err) => {
						console.error("Error inserting Journal Entry:", err);
					});
				} else {
					frappe.call({
						method: 'frappe.client.get_list',
						args: {
							doctype: 'Iqama Renewal Fee Tracking',
							filters: filters_residency_renewal,
							fields: fields_residency_renewal,
							limit_page_length: false
						},
						callback: function(r) {
							if (r.message && r.message.length > 0) {
								let journal_entry = frappe.model.get_new_doc('Journal Entry');
								journal_entry.voucher_type = 'Journal Entry';
								journal_entry.company = 'شركة عبدالله فهد المطيري للخدمات المساندة';
								journal_entry.posting_date = frappe.datetime.nowdate();
								journal_entry.expense_request_cf = frm.doc.payment_request_number;
								r.message.forEach(row => {
									let remarks = `Type: Residency Renewal\nهوية الموظف | ID: ${row.employee}\nالنوع: Residency Renewal\n`;
									let row_debit_current = frappe.model.add_child(journal_entry, 'Journal Entry Account', 'accounts');
									row_debit_current.account = '512004 - م - رسوم الجوازات (تشغيل) - M - Passport fees (operating) - AF';
									row_debit_current.account_type = 'Expense Account';
									row_debit_current.debit = parseFloat(row.renewal_fee_amount_for_current_year);
									row_debit_current.debit_in_account_currency = parseFloat(row.renewal_fee_amount_for_current_year);
									row_debit_current.cost_center = row.cost_center;
									row_debit_current.employee = row.employee;
									row_debit_current.user_remark = remarks;
									if (row.sadad_invoice_amount_for_advance_payments > 0) {
										let row_debit_advance = frappe.model.add_child(journal_entry, 'Journal Entry Account', 'accounts');
										row_debit_advance.account = '126004 - مصروفات مقدمة رسوم جوازات - Advance expenses, passport fees - AF';
										row_debit_advance.account_type = 'Expense Account';
										row_debit_advance.debit = parseFloat(row.renewal_fee_amount_for_advance_payments);
										row_debit_advance.debit_in_account_currency = parseFloat(row.renewal_fee_amount_for_advance_payments);
										row_debit_advance.cost_center = row.cost_center;
										row_debit_advance.employee = row.employee;
										row_debit_advance.user_remark = remarks;
									}
									let row_credit = frappe.model.add_child(journal_entry, 'Journal Entry Account', 'accounts');
									row_credit.account = '122001 - البنك الاهلي - تشغيل - National Bank - running - AF';
									row_credit.credit = parseFloat(row.renewal_fee_amount);
									row_credit.credit_in_account_currency = parseFloat(row.renewal_fee_amount);
									row_credit.user_remark = remarks;
									row_credit.account_type = 'Bank',
										row_credit.bank_account = "الاهلى تشغيل - الاهلى تشغيل";
									row_credit.party_type = 'Employee';
									row_credit.party = row.employee;
									frappe.call({
										method: 'frappe.client.set_value',
										args: {
											doctype: 'Iqama Renewal Fee Tracking',
											name: row.name,
											fieldname: 'jv_created_for_renewal_fees',
											value: 1
										}
									});
								});
								frappe.db.insert(journal_entry).then((doc) => {}).catch((err) => {
									console.error("Error inserting Journal Entry:", err);
								});
							} else {
								frappe.msgprint(__('No data matching the criteria to process'));
							}
						}
					});
				}
			}
		});
	}catch (error) {
	    console.error('Error in create_journal_entries:', error);
	}
}

function fetch_and_set_jv_options(frm) {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			limit_page_length: false,
			fields: ['payment_request_doc_number_residency_renewal', 'payment_request_doc_number_sadad_invoice'],
		},
		callback: function(r) {
			if (r.message) {
				let paymentRequestNumbers = new Set();
				r.message.forEach(d => {
					if (d.payment_request_doc_number_residency_renewal) {
						paymentRequestNumbers.add(d.payment_request_doc_number_residency_renewal);
					}
					if (d.payment_request_doc_number_sadad_invoice) {
						paymentRequestNumbers.add(d.payment_request_doc_number_sadad_invoice);
					}
				});
				frm.set_query('payment_request_number', function() {
					return {
						filters: [
							['name', 'in', Array.from(paymentRequestNumbers)]
						],
					};
				});
			}
		},
	});
}

function fetchAndDisplayData() {
	frappe.call({
		method: 'frappe.client.get_list',
		args: {
			doctype: 'Iqama Renewal Fee Tracking',
			fields: ['status', 'department', 'iqama_expiration_date'],
			limit_page_length: false
		},
		callback: function(r) {
			if (r.message) {
				let data = r.message;
				let statusCounts = {};
				let departmentCounts = {};
				let expiredCounts = {
					expired: 0,
					expiringThisWeek: 0,
					expiringNextWeek: 0,
					expiringThisMonth: 0
				};
				const today = new Date();
				const thisWeekEnd = new Date(today);
				thisWeekEnd.setDate(today.getDate() + (7 - today.getDay()));
				const nextWeekEnd = new Date(thisWeekEnd);
				nextWeekEnd.setDate(thisWeekEnd.getDate() + 7);
				const thisMonthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);
				data.forEach(record => {
					statusCounts[record.status] = (statusCounts[record.status] || 0) + 1;
					if (!['Rejected', 'Renewed'].includes(record.status)) {
						departmentCounts[record.department] = (departmentCounts[record.department] || 0) + 1;
						let expirationDate = new Date(record.iqama_expiration_date);
						if (expirationDate < today) expiredCounts.expired++;
						else if (expirationDate <= thisWeekEnd) expiredCounts.expiringThisWeek++;
						else if (expirationDate <= nextWeekEnd) expiredCounts.expiringNextWeek++;
						else if (expirationDate <= thisMonthEnd) expiredCounts.expiringThisMonth++;
					}
				});
				for (let status in statusCounts) {
					document.getElementById(`status-${status.toLowerCase().replace(/\s+/g, '-')}`).querySelector('.stat-value').textContent = statusCounts[status];
				}
				let topDepartmentsHtml = Object.keys(departmentCounts).sort((a, b) => departmentCounts[b] - departmentCounts[a]).slice(0, 10).map(dept => `<div class="stat-item">${dept}: <span class="stat-value">${departmentCounts[dept]}</span></div>`).join('');
				document.getElementById('top-departments').innerHTML = topDepartmentsHtml;
				document.getElementById('expired').querySelector('.stat-value').textContent = expiredCounts.expired;
				document.getElementById('expiring-this-week').querySelector('.stat-value').textContent = expiredCounts.expiringThisWeek;
				document.getElementById('expiring-next-week').querySelector('.stat-value').textContent = expiredCounts.expiringNextWeek;
				document.getElementById('expiring-this-month').querySelector('.stat-value').textContent = expiredCounts.expiringThisMonth;
			}
		}
	});
}

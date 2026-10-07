// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.ui.form.on('Payment Requisition', {
	setup: function (frm) {
		frm.set_query('payment_approver', () => ({
			query: 'afmco.financial_operations.api.payment_approver.active_approvers',
		}))
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

/** Client script for Payment Requisition. */

// Shared helpers ---------------------------------------------------------------
const user_language = frappe.boot.user.language || 'en';
const isRTL = user_language === 'ar';
const JOURNAL_ENTRY_PAYMENT_TYPES = Object.freeze(['EOS', 'Vacation Allowance', 'SADAD Payment']);

function escapeHtml(value) {
    return frappe.utils.escape_html(value === null || value === undefined ? '' : String(value));
}

function escapeHtmlWithLineBreaks(value) {
    return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

function fetchListRecords(doctype, args = {}) {
    return frappe.xcall('frappe.desk.reportview.get_list', {
        doctype,
        ...args
    });
}

function build_afmco_table(headers_html, rows_html, tfoot_html = '') {
    return `
        <div class="table-responsive">
            <table class="table table-bordered text-muted" style="font-size: 13px;">
                ${headers_html ? `<thead style="background-color: var(--control-bg);"><tr>${headers_html}</tr></thead>` : ''}
                <tbody>
                    ${rows_html}
                </tbody>
                ${tfoot_html ? `<tfoot>${tfoot_html}</tfoot>` : ''}
            </table>
        </div>
    `;
}

function build_afmco_alert(type, message, icon, messageIsSafeHtml = false) {
    const safeType = escapeHtml(type);
    const safeIcon = escapeHtml(icon);
    const safeMessage = messageIsSafeHtml ? String(message) : escapeHtml(message);

    return `
        <div class="alert alert-${safeType} form-message d-flex align-items-center mb-3">
            <i class="fa ${safeIcon} mx-2 text-${safeType}"></i>
            <div>${safeMessage}</div>
        </div>
    `;
}

const AFMCO_SECTION_STORAGE_PREFIX = 'afmco-dashboard-section';

function getAfmcoSectionStorageKey(sectionKey) {
    const user = (frappe.session && frappe.session.user) || 'Guest';
    return `${AFMCO_SECTION_STORAGE_PREFIX}:${user}:${sectionKey}`;
}

function getAfmcoSectionCollapsed(sectionKey, collapsedByDefault) {
    try {
        const storedState = localStorage.getItem(getAfmcoSectionStorageKey(sectionKey));
        if (storedState === 'collapsed') return true;
        if (storedState === 'expanded') return false;
    } catch (error) {
        // Keep the default when storage is unavailable.
    }

    return Boolean(collapsedByDefault);
}

function saveAfmcoSectionCollapsed(sectionKey, collapsed) {
    try {
        localStorage.setItem(
            getAfmcoSectionStorageKey(sectionKey),
            collapsed ? 'collapsed' : 'expanded'
        );
    } catch (error) {
        // The dashboard remains usable when storage is unavailable.
    }
}

function getAfmcoDashboardContainer(frm) {
    const firstElement = candidate => {
        try {
            if (!candidate || !candidate.length || typeof candidate.first !== 'function') return null;
            const $first = candidate.first();
            if (
                !$first ||
                !$first.length ||
                typeof $first.first !== 'function' ||
                typeof $first.find !== 'function' ||
                typeof $first.append !== 'function' ||
                typeof $first.prepend !== 'function'
            ) {
                return null;
            }
            return $first;
        } catch (error) {
            return null;
        }
    };

    const dashboard = frm && frm.dashboard;
    const dashboardCandidates = dashboard ? [dashboard.parent, dashboard.wrapper] : [];
    for (const candidate of dashboardCandidates) {
        const $candidate = firstElement(candidate);
        if ($candidate) return $candidate;
    }

    const scopedRoots = [frm && frm.wrapper, frm && frm.page && frm.page.body];
    for (const root of scopedRoots) {
        const $root = firstElement(root);
        if (!$root || typeof $root.find !== 'function') continue;

        try {
            const $dashboard = firstElement($root.find('.form-dashboard'));
            if ($dashboard) return $dashboard;
        } catch (error) {
            // Skip malformed roots and continue to the next scoped candidate.
        }
    }

    return null;
}

function removeAfmcoDashboardSections(frm, selector) {
    const $container = getAfmcoDashboardContainer(frm);
    if (!$container || !selector || typeof $container.find !== 'function') return;

    let $targets;
    try {
        $targets = $container.find(selector);
    } catch (error) {
        return;
    }
    if (!$targets || typeof $targets.each !== 'function') return;

    $targets.each(function() {
        const $target = $(this);
        if ($target.hasClass('custom')) {
            $target.remove();
            return;
        }

        const $outer = $target
            .parentsUntil($container, '.form-dashboard-section.custom, .form-section.custom')
            .first();
        if ($outer.length) {
            $outer.remove();
        } else {
            $target.remove();
        }
    });
}

function appendAfmcoDashboardSection(frm, html) {
    const $container = getAfmcoDashboardContainer(frm);
    if (!$container || typeof $container.append !== 'function') return null;

    let $section;
    try {
        const $elements = $(html);
        if (!$elements || !$elements.length || typeof $elements.first !== 'function') return null;
        $section = $elements.first();
    } catch (error) {
        return null;
    }

    if (!$section || !$section.length) return null;
    $container.append($section);
    if (frm && frm.dashboard && typeof frm.dashboard.show === 'function') {
        frm.dashboard.show();
    } else {
        $container.addClass('visible-section').removeClass('empty-section hidden');
    }
    return $section;
}

function buildAfmcoCollapsibleSection({
    sectionKey,
    title,
    meta = '',
    bodyHtml,
    wrapperClass = '',
    bodyClass = '',
    collapsedByDefault = false
}) {
    const collapsed = getAfmcoSectionCollapsed(sectionKey, collapsedByDefault);
    const safeSectionKey = escapeHtml(sectionKey);
    const safeTitle = escapeHtml(title);
    const safeMeta = escapeHtml(meta);
    const safeWrapperClass = wrapperClass ? ` ${escapeHtml(wrapperClass)}` : '';
    const safeBodyClass = bodyClass ? ` ${escapeHtml(bodyClass)}` : '';
    const bodyId = `afmco-section-body-${String(sectionKey).replace(/[^A-Za-z0-9_-]/g, '-')}`;

    return `
        <div class="row form-section card-section${safeWrapperClass}">
            <div
                class="section-head collapsible${collapsed ? ' collapsed' : ''} afmco-dashboard-toggle"
                role="button"
                tabindex="0"
                aria-expanded="${collapsed ? 'false' : 'true'}"
                aria-controls="${escapeHtml(bodyId)}"
                data-afmco-section-key="${safeSectionKey}"
            >
                <span class="collapse-indicator">${frappe.utils.icon(collapsed ? 'es-line-down' : 'es-line-up', 'sm', 'mb-1')}</span>
                <span class="font-weight-bold text-dark">${safeTitle}</span>
                ${safeMeta ? `<span class="text-muted small mx-2">${safeMeta}</span>` : ''}
            </div>
            <div id="${escapeHtml(bodyId)}" class="section-body${collapsed ? ' hide' : ''}${safeBodyClass}">
                ${bodyHtml}
            </div>
        </div>
    `;
}

function toggleAfmcoDashboardSection(header) {
    const $header = $(header);
    const collapsed = !$header.hasClass('collapsed');
    const $body = $header.next('.section-body');

    $header
        .toggleClass('collapsed', collapsed)
        .attr('aria-expanded', collapsed ? 'false' : 'true');
    $body.toggleClass('hide', collapsed);
    $header.find('.collapse-indicator').html(
        frappe.utils.icon(collapsed ? 'es-line-down' : 'es-line-up', 'sm', 'mb-1')
    );

    const sectionKey = $header.attr('data-afmco-section-key');
    if (sectionKey) {
        saveAfmcoSectionCollapsed(sectionKey, collapsed);
    }
}

function bindAfmcoDashboardEvents() {
    const $document = $(document);

    $document
        .off('click.afmcoDashboardToggle', '.afmco-dashboard-toggle')
        .on('click.afmcoDashboardToggle', '.afmco-dashboard-toggle', function() {
            toggleAfmcoDashboardSection(this);
        });

    $document
        .off('keydown.afmcoDashboardToggle', '.afmco-dashboard-toggle')
        .on('keydown.afmcoDashboardToggle', '.afmco-dashboard-toggle', function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleAfmcoDashboardSection(this);
            }
        });

    $document
        .off('click.afmcoTransferRow', '.afmco-transfer-row')
        .on('click.afmcoTransferRow', '.afmco-transfer-row', function() {
            const documentName = $(this).attr('data-docname');
            if (documentName) {
                frappe.set_route('Form', 'Payment Requisition', documentName);
            }
        });
}

// Form events ------------------------------------------------------------------
frappe.ui.form.on('Payment Requisition', {

    setup(frm) {
        if (!frm.doc.created_by) {
            frm.set_value('created_by', frappe.session.user);
        }
    },

    onload(frm) {
        frm.set_query('bank_account', () => ({
            filters: { account_type: ['in', ['Bank']] }
        }));

        if (frm.is_new()) {
            frm.set_value('created_by', frappe.session.user);
            frm.set_df_property('created_by', 'read_only', 1);
        }

        if (frm.doc.workflow_state === 'Financial Controller' && frappe.user_roles.includes('Auditor')) {
            displayPaymentApproverPermissions(frm);
        }
    },

    refresh(frm) {
        bindAfmcoDashboardEvents();
        cleanupExistingAlerts(frm);
        showDataDashboard(frm);
        renderRemarkExcelDashboard(frm);
        handlePendingWorkflow(frm);
        addSystemManagerButtons(frm);

        handleUrgentRequest(frm);
        handlePaymentVerification(frm);
        validateAndDisplayBankAccountAlert(frm);
        handleFinancialControllerPermissions(frm);

        addPreviousRecordsButton(frm);
        addUrgentButton(frm);
        processCompletedWorkflowTransitions(frm);
        addCreateJVButton(frm);
        addSupportingPackButton(frm);
    },

    remark(frm) {
        renderRemarkExcelDashboard(frm);
    },

    validate(frm) {
        if (frm.doc.account_no) {
            const cleaned = frm.doc.account_no.replace(/[\s\-_]+/g, '').toUpperCase();
            if (cleaned !== frm.doc.account_no && validateBankAccount(cleaned)) {
                frm.set_value('account_no', cleaned);
            }
        }

        if (frm.doc.payment_type && frm.doc.payment_type.startsWith('-')) {
            frappe.msgprint({
                title: __('Error'),
                indicator: 'red',
                message: __('Please select a valid payment type from the dropdown list.')
            });
            frappe.validated = false;
        }

        if (frm.doc.mode_of_payment && frm.doc.mode_of_payment.startsWith('-')) {
            frappe.msgprint({
                title: __('Error'),
                indicator: 'red',
                message: __('Please select a valid mode of payment from the dropdown list.')
            });
            frappe.validated = false;
        }
    },

    account_no(frm) {
        validateAndDisplayBankAccountAlert(frm);
    },

    mode_of_payment(frm) {
        validateAndDisplayBankAccountAlert(frm);
    },

    open_reference_document(frm) {
        let doctype = frm.doc.payment_type;
        if (doctype === 'Payroll (Salary)') {
            doctype = 'payroll-entry';
        }
        frappe.set_route('Form', doctype, frm.doc.tax_invoice_number);
    }
});

// Journal Entry creation -------------------------------------------------------
function addCreateJVButton(frm) {
    const buttonLabel = __('Create JV');
    frm.remove_custom_button(buttonLabel);

    if (
        frm.doc.docstatus === 1 &&
        (!frm.doc.jv_status || frm.doc.jv_status === 'JV Not Created') &&
        JOURNAL_ENTRY_PAYMENT_TYPES.includes(frm.doc.payment_type)
    ) {
        frm.add_custom_button(buttonLabel, () => openCreateJVDialog(frm)).addClass('btn-primary');
    }
}

function addSupportingPackButton(frm) {
    const buttonLabel = __('Supporting Pack');
    frm.remove_custom_button(buttonLabel);

    if (frm.doc.jv_status === 'JV Created') {
        frm.add_custom_button(buttonLabel, () => chooseSupportingPackEntry(frm));
    }
}

function chooseSupportingPackEntry(frm) {
    frappe.db.get_list('Journal Entry', {
        filters: { expense_request_cf: frm.doc.name, docstatus: ['<', 2] },
        fields: ['name'],
        order_by: 'creation desc',
    }).then(entries => {
        if (!entries.length) {
            frappe.msgprint(__('No Journal Entry is linked to this Payment Requisition.'));
        } else if (entries.length === 1) {
            attachSupportingPack(frm, entries[0].name);
        } else {
            frappe.prompt(
                {
                    label: __('Journal Entry'),
                    fieldname: 'journal_entry',
                    fieldtype: 'Select',
                    options: entries.map(entry => entry.name),
                    default: entries[0].name,
                    reqd: 1,
                },
                values => attachSupportingPack(frm, values.journal_entry),
                __('Supporting Pack')
            );
        }
    });
}

function attachSupportingPack(frm, journalEntry) {
    frappe.call({
        method: 'afmco.financial_operations.api.requisition_pack.attach_pack',
        args: { requisition: frm.doc.name, journal_entry: journalEntry },
        freeze: true,
        freeze_message: __('Preparing the supporting pack...'),
    }).then(({ message }) => {
        if (message.queued) {
            frappe.msgprint(__('The supporting pack is being prepared and will be attached to {0}.', [journalEntry]));
            return;
        }
        let text = __('The supporting pack is attached to {0}.', [journalEntry]);
        if (message.skipped.length) {
            text += '<br>' + __('Not included: {0}', [message.skipped.map(frappe.utils.escape_html).join(', ')]);
        }
        frappe.msgprint(text);
    });
}

function openCreateJVDialog(frm) {
    const dialog = new frappe.ui.Dialog({
        title: __('Journal Entry Details'),
        fields: [
            {
                label: __('Credit Bank Account'),
                fieldname: 'bank_account',
                fieldtype: 'Link',
                options: 'Account',
                reqd: 1,
                get_query: () => ({ filters: { is_group: 0, account_type: 'Bank' } })
            },
            {
                label: __('Employee Classification'),
                fieldname: 'employee_type',
                fieldtype: 'Select',
                options: ['Project Employee (Projects)', 'Administration Employee (Administration)'],
                default: 'Project Employee (Projects)',
                reqd: 1,
                hidden: !JOURNAL_ENTRY_PAYMENT_TYPES.includes(frm.doc.payment_type)
            }
        ],
        primary_action_label: __('Create JV'),
        primary_action(values) {
            dialog.hide();
            processJournalEntryCreation(frm, values);
        }
    });

    return frappe.db.get_value('Account', { account_number: '122001' }, 'name')
        .then(res => {
            const accountName = res?.message?.name || res?.name;
            if (accountName) {
                dialog.set_value('bank_account', accountName);
            }
        })
        .catch(error => {
            console.warn('Unable to load the default bank account:', error);
        })
        .then(() => {
            dialog.show();
            return dialog;
        })
        .catch(error => {
            console.error('Unable to open the Journal Entry dialog:', error);
            frappe.msgprint({
                title: __('Journal Entry Dialog Failed'),
                indicator: 'red',
                message: __('The Journal Entry dialog could not be opened. Please try again.')
            });
            return null;
        });
}

function allocateSadadAmountByYear(amount, startDate, periodMonths) {
    const normalizedAmount = Number(amount);
    const normalizedPeriod = Number.parseInt(periodMonths, 10);
    const dateMatch = String(startDate || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);

    if (!Number.isFinite(normalizedAmount) || normalizedAmount < 0) {
        throw new Error(__('SADAD amount must be a valid positive number.'));
    }
    if (!dateMatch) {
        throw new Error(__('Bank Payment Date or Posting Date is invalid.'));
    }

    const startMonth = Number(dateMatch[2]) - 1;
    if (startMonth < 0 || startMonth > 11) {
        throw new Error(__('Bank Payment Date or Posting Date is invalid.'));
    }

    if (!Number.isFinite(normalizedPeriod) || normalizedPeriod <= 0) {
        return {
            currentYearAmount: Number(normalizedAmount.toFixed(2)),
            futureAmount: 0,
            monthsInCurrentYear: 0
        };
    }

    const monthsInCurrentYear = Math.min(normalizedPeriod, 12 - startMonth);
    const currentYearAmount = Number((normalizedAmount * monthsInCurrentYear / normalizedPeriod).toFixed(2));
    const futureAmount = Number((normalizedAmount - currentYearAmount).toFixed(2));

    return { currentYearAmount, futureAmount, monthsInCurrentYear };
}

function validateJournalEntryRows(rows) {
    if (!Array.isArray(rows) || rows.length === 0) {
        throw new Error(__('No valid Journal Entry rows were generated.'));
    }

    let totalDebit = 0;
    let totalCredit = 0;

    rows.forEach(row => {
        const debit = Number(row.debit_in_account_currency || 0);
        const credit = Number(row.credit_in_account_currency || 0);

        if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
            throw new Error(__('Journal Entry contains an invalid amount.'));
        }
        if ((debit > 0 || credit > 0) && !row.account) {
            throw new Error(__('Journal Entry contains a row without an account.'));
        }

        totalDebit += debit;
        totalCredit += credit;
    });

    totalDebit = Number(totalDebit.toFixed(2));
    totalCredit = Number(totalCredit.toFixed(2));

    if (totalDebit <= 0 || totalCredit <= 0) {
        throw new Error(__('Journal Entry must contain both debit and credit amounts.'));
    }
    if (Math.round(totalDebit * 100) !== Math.round(totalCredit * 100)) {
        throw new Error(__('Journal Entry is not balanced. Debit: {0}, Credit: {1}', [totalDebit, totalCredit]));
    }

    return { totalDebit, totalCredit };
}

function extractRemarkAmount(remark, patterns) {
    for (const pattern of patterns) {
        const match = remark.match(pattern);
        if (match) {
            const amount = Number(String(match[1]).replace(/,/g, ''));
            if (Number.isFinite(amount)) return amount;
        }
    }
    return 0;
}

function getSadadExpenseAccountNumber(type, isAdmin) {
    const administration = ['532005', '532006', '532007', '532011'];
    const projects = ['512004', '512005', '512006', '512009'];

    if (type === 'Issue or renew residence permit') return isAdmin ? administration[1] : projects[0];
    if (type === 'Transfer of sponsorship') return isAdmin ? administration[3] : projects[3];
    if (type === 'Change of profession') return isAdmin ? administration[0] : projects[1];
    if (type === 'Exit and Return Visa' || type === 'Extend exit and re-entry visa (1) month') {
        return isAdmin ? administration[2] : projects[2];
    }
    return null;
}

function getSadadPrepaidAccountNumber(type) {
    return type === 'Transfer of sponsorship' ? '126006' : '126004';
}

function showJournalEntryError(error, journalEntry) {
    if (journalEntry && journalEntry.accounts) {
        frappe.model.clear_table(journalEntry, 'accounts');
    }

    console.error('Journal Entry creation stopped:', error);
    const detail = error && error.message ? error.message : __('Please review the request data and try again.');
    frappe.msgprint({
        title: __('Journal Entry Not Created'),
        indicator: 'red',
        message: __('The Journal Entry was not created: {0}', [escapeHtml(detail)])
    });
}

function processJournalEntryCreation(frm, values) {
    const isAdmin = values.employee_type === 'Administration Employee (Administration)';
    const accountNumbers = isAdmin
        ? ['531002', '531003', '531004']
        : ['212004', '212002', '212001'];
    const allAccountNumbers = [
        ...accountNumbers,
        '532005', '532006', '532007', '532011',
        '512004', '512005', '512006', '512009',
        '126004', '126006'
    ];
    let journalEntry = null;

    frappe.show_alert({ message: __('Preparing Journal Entry...'), indicator: 'orange' });

    return frappe.model.with_doctype('Journal Entry')
        .then(() => frappe.model.with_doctype('Journal Entry Account'))
        .then(() => fetchListRecords('Account', {
            filters: { account_number: ['in', allAccountNumbers] },
            fields: ['name', 'account_number'],
            limit: allAccountNumbers.length
        }))
        .then(accounts => {
            const accountsMap = {};
            (accounts || []).forEach(account => {
                accountsMap[account.account_number] = account.name;
            });

            const remark = frm.doc.remark || '';
            journalEntry = frappe.model.get_new_doc('Journal Entry');
            journalEntry.expense_request_cf = frm.doc.name;
            journalEntry.user_remark = remark || `Expense Request: ${frm.doc.name}`;

            const addRow = (account, debit, credit, copyCostCenter, accountLabel) => {
                const normalizedDebit = Number(debit || 0);
                const normalizedCredit = Number(credit || 0);
                if (normalizedDebit <= 0 && normalizedCredit <= 0) return null;
                if (!account) {
                    throw new Error(__('Required account is missing: {0}', [accountLabel || __('Unknown Account')]));
                }

                const row = frappe.model.get_new_doc('Journal Entry Account', journalEntry, 'accounts');
                row.account = account;
                row.debit_in_account_currency = normalizedDebit;
                row.credit_in_account_currency = normalizedCredit;

                if (copyCostCenter) {
                    if (frm.doc.cost_center) row.cost_center = frm.doc.cost_center;
                    if (frm.doc.project) row.project = frm.doc.project;
                }
                return row;
            };

            if (frm.doc.payment_type === 'EOS') {
                const ticket = extractRemarkAmount(remark, [/Ticket Allowance:\s*([\d,]+(?:\.\d+)?)/i]);
                const vacation = extractRemarkAmount(remark, [
                    /Total Vacation Allowance:\s*([\d,]+(?:\.\d+)?)/i,
                    /Vacation Allowance:\s*([\d,]+(?:\.\d+)?)/i
                ]);
                const eos = extractRemarkAmount(remark, [/EOS:\s*([\d,]+(?:\.\d+)?)/i]);

                addRow(accountsMap[accountNumbers[2]], ticket, 0, isAdmin, accountNumbers[2]);
                addRow(accountsMap[accountNumbers[1]], vacation, 0, isAdmin, accountNumbers[1]);
                addRow(accountsMap[accountNumbers[0]], eos, 0, isAdmin, accountNumbers[0]);
                addRow(values.bank_account, 0, frm.doc.amount, false, __('Credit Bank Account'));
            } else if (frm.doc.payment_type === 'Vacation Allowance') {
                const totalTicket = extractRemarkAmount(remark, [
                    /Total Ticket\|\s*([\d,]+(?:\.\d+)?)/i,
                    /Ticket Allowance:\s*([\d,]+(?:\.\d+)?)/i
                ]);
                const totalAmount = Number(frm.doc.amount || 0);
                const ticket = Math.min(totalTicket, totalAmount);
                const vacation = Number((totalAmount - ticket).toFixed(2));

                addRow(accountsMap[accountNumbers[2]], ticket, 0, isAdmin, accountNumbers[2]);
                addRow(accountsMap[accountNumbers[1]], vacation, 0, isAdmin, accountNumbers[1]);
                addRow(values.bank_account, 0, totalAmount, false, __('Credit Bank Account'));
            } else if (frm.doc.payment_type === 'SADAD Payment') {
                const startDate = frm.doc.bank_payment_date || frm.doc.posting_date;
                if (!startDate) {
                    throw new Error(__('Please verify Bank Payment Date or Posting Date for year allocation.'));
                }

                let parsedBlocks = 0;
                remark.split('------------------------').forEach(block => {
                    if (!block.trim()) return;

                    const typeMatch = block.match(/Type:\s*([^\n\r]+)/i);
                    const periodMatch = block.match(/Period:\s*(\d+)/i);
                    const amountMatch = block.match(/Amount:\s*([\d,]+(?:\.\d+)?)/i);
                    if (!typeMatch || !amountMatch) return;

                    const type = typeMatch[1].trim();
                    const period = periodMatch ? Number.parseInt(periodMatch[1], 10) : 0;
                    const amount = Number(amountMatch[1].replace(/,/g, ''));
                    const expenseAccountNumber = getSadadExpenseAccountNumber(type, isAdmin);
                    if (!expenseAccountNumber) {
                        throw new Error(__('SADAD service type is not configured: {0}', [type]));
                    }

                    const allocation = allocateSadadAmountByYear(amount, startDate, period);
                    addRow(
                        accountsMap[expenseAccountNumber],
                        allocation.currentYearAmount,
                        0,
                        isAdmin,
                        expenseAccountNumber
                    );

                    if (allocation.futureAmount > 0) {
                        const prepaidAccountNumber = getSadadPrepaidAccountNumber(type);
                        addRow(
                            accountsMap[prepaidAccountNumber],
                            allocation.futureAmount,
                            0,
                            isAdmin,
                            prepaidAccountNumber
                        );
                    }
                    parsedBlocks += 1;
                });

                if (parsedBlocks === 0) {
                    throw new Error(__('No structured SADAD rows with Type and Amount were found in the remark.'));
                }
                addRow(values.bank_account, 0, frm.doc.amount, false, __('Credit Bank Account'));
            } else {
                throw new Error(__('Journal Entry creation is not configured for payment type: {0}', [frm.doc.payment_type || '-']));
            }

            validateJournalEntryRows(journalEntry.accounts || []);
            frappe.set_route('Form', journalEntry.doctype, journalEntry.name);
            return journalEntry;
        })
        .catch(error => {
            showJournalEntryError(error, journalEntry);
            return null;
        });
}

// Alerts and bank-account validation ------------------------------------------
function cleanupExistingAlerts(frm) {
    const $dashboard = getAfmcoDashboardContainer(frm);
    if (!$dashboard || typeof $dashboard.find !== 'function') return;
    $dashboard.find('#afmco-alerts-container').remove();
}

function createAlert(type, icon, title, message, onClick) {
    const safeType = escapeHtml(type);
    const safeIcon = escapeHtml(icon);
    const safeTitle = escapeHtml(title);
    const safeMessage = escapeHtmlWithLineBreaks(message);
    const alertElement = $(`
        <div class="alert alert-${safeType} alert-dismissible form-message d-flex align-items-center mb-3">
            <i class="${safeIcon} mx-2 text-${safeType}"></i>
            <div>
                <strong>${safeTitle}</strong>: ${safeMessage}
            </div>
        </div>
    `);

    if (onClick) {
        alertElement.css('cursor', 'pointer').click(onClick);
    }

    return alertElement;
}

function addAlertToDashboard(alertElement, frm) {
    const $container = getAfmcoDashboardContainer(frm);
    if (!$container || typeof $container.find !== 'function') return null;

    let $alertsContainer = $container.find('#afmco-alerts-container').first();
    if (!$alertsContainer.length) {
        $alertsContainer = $('<div id="afmco-alerts-container" class="custom"></div>');
        $container.prepend($alertsContainer);
    }
    $alertsContainer.append(alertElement);
    if (frm && frm.dashboard && typeof frm.dashboard.show === 'function') {
        frm.dashboard.show();
    } else {
        $container.addClass('visible-section').removeClass('empty-section hidden');
    }
    return $alertsContainer;
}

function handleUrgentRequest(frm) {
    if (frm.doc.if_it__urgent !== 1) return;

    const alertText = frm.doc.reason_of_urgency || __('No reason provided');
    const alertElement = createAlert(
        'danger',
        'fa fa-exclamation-triangle',
        __('Urgent'),
        alertText,
        () => {
            frm.set_df_property('if_it__urgent', 'hidden', 0);
            frm.set_df_property('reason_of_urgency', 'hidden', 0);
        }
    );

    alertElement.addClass('alert-urgent-request');
    addAlertToDashboard(alertElement, frm);

    frm.set_df_property('if_it__urgent', 'hidden', 1);
    frm.set_df_property('reason_of_urgency', 'hidden', 1);
}

function handlePaymentVerification(frm) {
    if (frm.doc.verify_payment !== 1) return;

    const alertElement = createAlert(
        'info',
        'fa fa-check-circle',
        __('Paid'),
        __('This transaction has been documented as settled. Please ensure all necessary approvals and authorizations are verified before proceeding.'),
        () => {
            frm.set_df_property('verify_payment', 'hidden', 0);
        }
    );

    alertElement.addClass('alert-payment-verified');
    addAlertToDashboard(alertElement, frm);

    frm.set_df_property('verify_payment', 'hidden', 1);
}

function validateAndDisplayBankAccountAlert(frm) {
    const fieldWrapper = frm.get_field('account_no')?.$wrapper;

    if (frm.doc.payment_type === 'SADAD Payment' ||
        frm.doc.mode_of_payment === 'SADAD Payment' ||
        frm.doc.mode_of_payment === '--- Choose from List ---') {
        frm.set_df_property('account_no', 'description', '');
        if (fieldWrapper) {
            fieldWrapper.removeClass('has-error has-success');
            fieldWrapper.find('.form-control').css('border-color', '');
        }
        return;
    }

    const raw_account_no = frm.doc.account_no || '';
    const cleaned_account_no = raw_account_no.replace(/[\s\-_]+/g, '').toUpperCase();

    if (!raw_account_no.trim()) {
        frm.set_df_property('account_no', 'hidden', 0);
        frm.set_df_property('account_no', 'description', `
            <div class="text-muted small mt-1">
                <i class="fa fa-info-circle mx-1 text-warning"></i> ${__('Account number field is empty.')}
            </div>
        `);
        if (fieldWrapper) {
            fieldWrapper.removeClass('has-error has-success');
            fieldWrapper.find('.form-control').css('border-color', '');
        }
        return;
    }

    const is_cleaned_valid = validateBankAccount(cleaned_account_no);
    const has_formatting_issue = raw_account_no !== cleaned_account_no;

    if (is_cleaned_valid && has_formatting_issue) {
        frm.set_df_property('account_no', 'hidden', 0);
        frm.set_df_property('account_no', 'description', `
            <div class="d-flex align-items-center justify-content-between mt-1 p-2 bg-light border border-warning rounded">
                <span class="text-warning small font-weight-bold">
                    <i class="fa fa-exclamation-triangle mx-1"></i> ${__('IBAN contains spaces or formatting issues.')}
                </span>
                <button class="btn btn-xs btn-warning fix-iban-btn font-weight-bold" type="button">
                    <i class="fa fa-magic mx-1"></i> ${__('Fix & Remove Spaces')}
                </button>
            </div>
        `);

        if (fieldWrapper) {
            fieldWrapper.addClass('has-error').removeClass('has-success');
            fieldWrapper.find('.form-control').css('border-color', '#ffc107');

            setTimeout(() => {
                fieldWrapper.find('.fix-iban-btn').off('click').on('click', function(e) {
                    e.preventDefault();
                    frm.set_value('account_no', cleaned_account_no);
                    frappe.show_alert({
                        message: __('IBAN spaces removed and formatted successfully!'),
                        indicator: 'green'
                    });
                });
            }, 100);
        }
    } else if (is_cleaned_valid && !has_formatting_issue) {
        frm.set_df_property('account_no', 'description', `
            <div class="text-success small mt-1 font-weight-bold">
                <i class="fa fa-check-circle mx-1"></i> ${__('Valid Saudi IBAN (SA)')}
            </div>
        `);
        if (fieldWrapper) {
            fieldWrapper.addClass('has-success').removeClass('has-error');
            fieldWrapper.find('.form-control').css('border-color', '#28a745');
        }
    } else {
        frm.set_df_property('account_no', 'hidden', 0);
        frm.set_df_property('account_no', 'description', `
            <div class="text-danger small mt-1 font-weight-bold">
                <i class="fa fa-exclamation-triangle mx-1"></i> ${__('Please verify the accuracy of the IBAN to avoid errors during banking transactions.')}
            </div>
        `);
        if (fieldWrapper) {
            fieldWrapper.addClass('has-error').removeClass('has-success');
            fieldWrapper.find('.form-control').css('border-color', '#dc3545');
        }
    }
}

function validateBankAccount(account_number) {
    if (!account_number || typeof account_number !== 'string') return false;
    const normalizedAccount = account_number.replace(/[\s\-_]+/g, '').toUpperCase();
    if (!/^SA\d{22}$/.test(normalizedAccount)) return false;

    const rearranged = normalizedAccount.slice(4) + normalizedAccount.slice(0, 4);
    const numericIban = rearranged.replace(/[A-Z]/g, letter => String(letter.charCodeAt(0) - 55));
    let remainder = 0;

    for (const digit of numericIban) {
        remainder = (remainder * 10 + Number(digit)) % 97;
    }

    return remainder === 1;
}

function getAccountValidationResult(account_no) {
    if (!account_no) {
        return {
            hasError: true,
            title: __('Invalid IBAN'),
            message: __('Account number field is empty.'),
            type: 'warning'
        };
    }

    if (!validateBankAccount(account_no)) {
        return {
            hasError: true,
            title: __('Invalid IBAN'),
            message: __('Please verify the accuracy of the IBAN to avoid errors during banking transactions.'),
            type: 'warning'
        };
    }

    return { hasError: false };
}

function handleFinancialControllerPermissions(frm) {
    $('.payment-approver-message').remove();

    if (frm.doc.workflow_state === 'Financial Controller' && frappe.user_roles.includes('Auditor')) {
        displayPaymentApproverPermissions(frm);
    }
}

function displayPaymentApproverPermissions(frm) {
    if (!frm.doc.custom_role) return;

    const formatted_role = escapeHtmlWithLineBreaks(frm.doc.custom_role);
    const alertHtml = build_afmco_alert(
        'info',
        __('Please note that this document is pending approval from the {0}. Ensure all required verifications are completed before proceeding.', [formatted_role]),
        'fa-shield-alt',
        true
    );
    const message = `<div class="payment-approver-message">${alertHtml}</div>`;

    $('.payment-approver-message').remove();

    if (frm.page && frm.page.body) {
        $(frm.page.body).prepend(message);
    }
}

// Account audit dashboard ------------------------------------------------------
function addPreviousRecordsButton(frm) {
    const buttonLabel = __('Check Account Transactions');
    const allowedRoles = ['Auditor', 'General Manager', 'Projects Manager'];
    const hasPermission = frappe.user_roles.some(role => allowedRoles.includes(role));

    frm.remove_custom_button(buttonLabel);
    frm.remove_custom_button(buttonLabel, __('Reports'));

    if (hasPermission && frm.doc.account_no && validateBankAccount(frm.doc.account_no)) {
        const btn = frm.add_custom_button(
            buttonLabel,
            () => loadAndRenderAccountAuditDashboard(frm)
        );
        if (btn) btn.removeClass('btn-default btn-secondary').addClass('btn-primary');
    }
}

async function fetchAllAccountTransfers(frm, pageSize = 500) {
    const accountNumber = frm.doc.account_no;
    const documentName = frm.doc.name;
    const records = [];
    const seenNames = new Set();
    let start = 0;

    while (true) {
        const batch = await fetchListRecords('Payment Requisition', {
            filters: [
                ['account_no', '=', accountNumber],
                ['workflow_state', '!=', 'Rejected'],
                ['name', '!=', documentName]
            ],
            fields: ['name', 'date', 'amount'],
            order_by: 'date desc, name desc',
            limit: pageSize,
            start
        });

        if (!Array.isArray(batch)) {
            throw new Error(__('The account audit returned an invalid response.'));
        }

        let addedRecords = 0;
        batch.forEach(record => {
            if (!seenNames.has(record.name)) {
                seenNames.add(record.name);
                records.push(record);
                addedRecords += 1;
            }
        });

        if (batch.length < pageSize) break;
        if (addedRecords === 0) {
            throw new Error(__('Account audit pagination did not advance.'));
        }
        start += batch.length;
    }

    return records;
}

function handleAccountAuditError(error) {
    console.error('Account audit failed:', error);
    frappe.msgprint({
        title: __('Account Audit Failed'),
        indicator: 'red',
        message: __('The account audit could not be loaded. Please verify your permission and connection, then try again.')
    });
}

function loadAndRenderAccountAuditDashboard(frm) {
    if (frm.__afmco_account_audit_request) {
        frappe.show_alert({ message: __('Account audit is already loading...'), indicator: 'blue' });
        return frm.__afmco_account_audit_request.promise;
    }

    const requestKey = `${frm.doc.name || ''}:${frm.doc.account_no || ''}:${frm.doc.payment_type || ''}`;
    const request = { key: requestKey, promise: null };
    const isCurrentDocument = () => {
        const activeForm = typeof cur_frm === 'undefined' ? null : cur_frm;
        if (activeForm && activeForm !== frm) return false;

        return requestKey === `${frm.doc.name || ''}:${frm.doc.account_no || ''}:${frm.doc.payment_type || ''}`;
    };

    frappe.show_alert({ message: __('Loading account audit data...'), indicator: 'blue' });
    removeAfmcoDashboardSections(frm, '.account-audit-section');

    request.promise = fetchAllAccountTransfers(frm)
        .then(transfers => {
            if (!isCurrentDocument()) return null;

            return fetchListRecords('Employee', {
                filters: { bank_ac_no: frm.doc.account_no },
                fields: [
                    'employee', 'employee_number', 'employee_name', 'status', 'designation',
                    'department', 'branch', 'date_of_joining', 'iqama_expiration_date',
                    'bank_name', 'bank_ac_no', 'personal_email', 'cell_number'
                ],
                limit: 1
            }).then(employees => ({ transfers, employees }));
        })
        .then(result => {
            if (!result || !isCurrentDocument()) return null;

            const { transfers, employees } = result;

            const employee = employees && employees.length ? employees[0] : null;

            if (employee && frm.doc.payment_type === 'Petty Cash') {
                return fetchListRecords('GL Entry', {
                    filters: [['party', '=', employee.employee]],
                    fields: [{ SUM: 'debit', as: 'total_debit' }, { SUM: 'credit', as: 'total_credit' }],
                    group_by: 'party',
                    limit: 1
                }).then(gl => {
                    const balance = gl && gl.length
                        ? Number(gl[0].total_debit || 0) - Number(gl[0].total_credit || 0)
                        : 0;
                    if (isCurrentDocument()) {
                        renderAccountAuditCard(frm, transfers, employee, balance);
                    }
                });
            }

            renderAccountAuditCard(frm, transfers, employee, null);
            return null;
        })
        .catch(error => {
            if (isCurrentDocument()) {
                handleAccountAuditError(error);
            }
            return null;
        })
        .finally(() => {
            if (frm.__afmco_account_audit_request === request) {
                delete frm.__afmco_account_audit_request;
            }
        });

    frm.__afmco_account_audit_request = request;
    return request.promise;
}

function renderAccountAuditCard(frm, transfers, employee, pettyCashBalance) {
    const { tableRows, yearlySummary, grandTotal } = processTransferRecords(transfers || []);
    const displayedRows = tableRows.slice(0, 50);
    const transfersTable = createTransfersTable(displayedRows);
    const summaryTable = createSummaryTable(yearlySummary, grandTotal, frm.doc.amount || 0);
    const transferLimitNotice = tableRows.length > displayedRows.length
        ? `<div class="text-muted small mb-2">${escapeHtml(__('Showing the latest {0} of {1} transfers. Totals include all records.', [displayedRows.length, tableRows.length]))}</div>`
        : '';

    const employeeContent = employee
        ? createEmployeeTable(employee)
        : build_afmco_alert('warning', __('No employee account record linked to this IBAN.'), 'fa-exclamation-triangle');

    let pettyCashHtml = '';
    if (pettyCashBalance !== null) {
        const maxLimit = 20000;
        const percentage = Math.max(0, Math.min((pettyCashBalance / maxLimit) * 100, 100));
        pettyCashHtml = `
            <div class="mt-4 pt-3 border-top">
                <div class="text-muted font-weight-bold mb-2"><i class="fa fa-wallet mx-1"></i> ${__('Advance Balance Information')}</div>
                ${createProgressBar(percentage)}
                ${createBalanceTable(pettyCashBalance, maxLimit)}
            </div>
        `;
    }

    const auditCardHtml = buildAfmcoCollapsibleSection({
        sectionKey: 'account-audit-section',
        wrapperClass: 'account-audit-section custom mb-4',
        title: __('Account & Transaction Audit'),
        meta: `(${transfers.length} ${__('Previous Transactions')})`,
        collapsedByDefault: false,
        bodyHtml: `
            <div class="row">
                <div class="col-md-7">
                    <div class="text-muted font-weight-bold mb-2">${__('Previous Transfers')}</div>
                    ${transferLimitNotice}
                    ${transfersTable}
                    <div class="text-muted font-weight-bold mt-4 mb-2">${__('Yearly Summary')}</div>
                    ${summaryTable}
                </div>
                <div class="col-md-5">
                    <div class="text-muted font-weight-bold mb-2">${__('Employee Details')}</div>
                    ${employeeContent}
                    ${pettyCashHtml}
                </div>
            </div>
        `
    });

    appendAfmcoDashboardSection(frm, auditCardHtml);
}

function processTransferRecords(records) {
    const yearly_totals = {};
    let grand_total = 0;

    const tableRows = records.map(d => {
        const parsedYear = d.date ? new Date(d.date).getFullYear() : null;
        const fallbackYear = String(d.name || '').match(/\d{4}/)?.[0];
        const year = Number.isFinite(parsedYear) ? parsedYear : fallbackYear;
        const parsedAmount = Number(d.amount || 0);
        const amount = Number.isFinite(parsedAmount) ? parsedAmount : 0;

        if (year) {
            yearly_totals[year] = (yearly_totals[year] || 0) + amount;
        }
        grand_total += amount;

        return { name: d.name, date: d.date, amount: amount };
    });

    return { tableRows, yearlySummary: yearly_totals, grandTotal: grand_total };
}

function createTransfersTable(rows) {
    if (!rows || !rows.length) {
        return build_afmco_alert('warning', __('No previous transfers found for this account.'), 'fa-info-circle');
    }

    const tableRows = rows.map(d => `
        <tr class="afmco-transfer-row" data-docname="${escapeHtml(d.name)}" style="cursor: pointer;">
            <td><i class="fa fa-file-alt text-muted ${isRTL ? 'ms-1' : 'me-1'}"></i> ${escapeHtml(d.name)}</td>
            <td>${escapeHtml(d.date || '-')}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(d.amount))}</td>
        </tr>
    `).join('');

    const headers = `
        <th>${__('Document')}</th>
        <th>${__('Date')}</th>
        <th class="text-right">${__('Amount')}</th>
    `;

    return build_afmco_table(headers, tableRows);
}

function createSummaryTable(yearlySummary, grandTotal, currentAmount) {
    const years = Object.keys(yearlySummary || {}).sort((a, b) => b - a);
    const previousTransactionsTotal = Number(grandTotal || 0);
    const currentRequestAmount = Number(currentAmount || 0);
    const totalIncludingCurrentRequest = previousTransactionsTotal + currentRequestAmount;

    const summaryRows = years.length > 0 ? years.map(year => `
        <tr>
            <td><i class="fa fa-calendar text-muted ${isRTL ? 'ms-1' : 'me-1'}"></i> ${escapeHtml(year)}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(yearlySummary[year]))}</td>
        </tr>
    `).join('') : `
        <tr>
            <td colspan="2" class="text-center text-muted">${__('No previous transaction totals')}</td>
        </tr>
    `;

    const headers = `<th>${__('Year')}</th><th class="text-right">${__('Total')}</th>`;
    const tfoot = `
        <tr>
            <td class="font-weight-bold">${__('Previous Transactions Total')}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(previousTransactionsTotal))}</td>
        </tr>
        <tr>
            <td class="font-weight-bold">${__('Current Request')}</td>
            <td class="text-right font-weight-bold">${escapeHtml(format_currency(currentRequestAmount))}</td>
        </tr>
        <tr class="table-active">
            <td class="font-weight-bold"><i class="fa fa-calculator text-muted ${isRTL ? 'ms-1' : 'me-1'}"></i> ${__('Total Including Current Request')}</td>
            <td class="text-right font-weight-bold text-primary">${escapeHtml(format_currency(totalIncludingCurrentRequest))}</td>
        </tr>
    `;

    return build_afmco_table(headers, summaryRows, tfoot);
}

function createEmployeeTable(employee) {
    const fields = [
        { key: 'employee_name', label: 'Employee Name', icon: 'fa-id-card', color: 'primary' },
        { key: 'employee_number', label: 'Employee Number', icon: 'fa-hashtag', color: 'info' },
        { key: 'status', label: 'Status', icon: 'fa-toggle-on', color: 'success' },
        { key: 'department', label: 'Department', icon: 'fa-building', color: 'warning' },
        { key: 'iqama_expiration_date', label: 'Iqama Expiration Date', icon: 'fa-calendar-alt', color: 'danger' },
        { key: 'personal_email', label: 'Personal Email', icon: 'fa-envelope', color: 'primary' },
        { key: 'cell_number', label: 'Cell Number', icon: 'fa-mobile-alt', color: 'info' }
    ];

    const rows = fields.map(field => createTableRow(field, employee[field.key] || '-')).join('');
    return build_afmco_table('', rows);
}

function createTableRow(field, value) {
    const isExpired = field.key === 'iqama_expiration_date' && value !== '-' && new Date(value) < new Date();
    const isInactive = field.key === 'status' && value === 'Inactive';
    const dangerClass = (isExpired || isInactive) ? 'text-danger font-weight-bold' : '';

    return `
        <tr>
            <td class="font-weight-bold" style="width: 45%;">
                <i class="fa ${field.icon} text-${field.color} mx-1"></i>
                ${escapeHtml(__(field.label))}
            </td>
            <td class="${dangerClass}">
                ${escapeHtml(value)}
                ${isExpired ? '<i class="fa fa-exclamation-circle text-danger mx-1"></i>' : ''}
                ${isInactive ? '<i class="fa fa-times-circle text-danger mx-1"></i>' : ''}
            </td>
        </tr>
    `;
}

function createProgressBar(percentage) {
    const colorClass = percentage < 50 ? 'bg-success' : (percentage < 80 ? 'bg-warning' : 'bg-danger');

    return `
        <div class="mb-3">
            <div class="progress" style="height: 20px;">
                <div class="progress-bar ${colorClass}" role="progressbar"
                     style="width: ${percentage}%;"
                     aria-valuenow="${percentage}" aria-valuemin="0" aria-valuemax="100">
                    ${percentage.toFixed(0)}%
                </div>
            </div>
            <div class="text-center text-muted small mt-1">
                ${__('Petty Cash Balance')}: ${percentage.toFixed(2)}%
            </div>
        </div>
    `;
}

function createBalanceTable(final_balance, max_limit) {
    const headers = `
        <th>${__('Description')}</th>
        <th class="text-${isRTL ? 'left' : 'right'}">${__('Amount')}</th>
    `;
    const rows = `
        <tr>
            <td><i class="fa fa-balance-scale text-primary mx-1"></i> ${__('Final Balance')}</td>
            <td class="text-${isRTL ? 'left' : 'right'} font-weight-bold">${escapeHtml(format_currency(final_balance))}</td>
        </tr>
        <tr>
            <td><i class="fa fa-chart-line text-warning mx-1"></i> ${__('Maximum Allowed Limit')}</td>
            <td class="text-${isRTL ? 'left' : 'right'} font-weight-bold text-warning">${escapeHtml(format_currency(max_limit))}</td>
        </tr>
    `;
    return build_afmco_table(headers, rows);
}

// Workflow timeline and urgent actions ----------------------------------------
function getWorkflowLogField(log, fieldname) {
    try {
        return log[fieldname];
    } catch (error) {
        return null;
    }
}

function workflowSafeString(value) {
    if (value === null || value === undefined) return '';

    try {
        return String(value);
    } catch (error) {
        return '';
    }
}

function workflowEscapeHtml(value) {
    try {
        return escapeHtml(workflowSafeString(value));
    } catch (error) {
        return '';
    }
}

function workflowTranslate(value) {
    const text = workflowSafeString(value);
    if (!text) return '';

    try {
        return typeof __ === 'function' ? workflowSafeString(__(text)) : text;
    } catch (error) {
        return text;
    }
}

function normalizeWorkflowText(value) {
    return workflowSafeString(value).trim();
}

function getWorkflowLogTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;

    const rawValue = normalizeWorkflowText(value);
    if (!rawValue) return null;

    let timestamp = Date.parse(rawValue);
    if (Number.isFinite(timestamp)) return timestamp;

    const normalizedValue = rawValue
        .replace(' ', 'T')
        .replace(/\.(\d{3})\d+/, '.$1');
    timestamp = Date.parse(normalizedValue);

    return Number.isFinite(timestamp) ? timestamp : null;
}

function getSortedWorkflowLogs(workflowLogs) {
    if (!Array.isArray(workflowLogs)) return [];

    return workflowLogs
        .map((log, originalIndex) => ({
            log,
            originalIndex,
            timestamp: log && typeof log === 'object' && !Array.isArray(log)
                ? getWorkflowLogTimestamp(getWorkflowLogField(log, 'creation'))
                : null
        }))
        .filter(entry => entry.log && typeof entry.log === 'object' && !Array.isArray(entry.log))
        .sort((left, right) => {
            if (left.timestamp === null && right.timestamp === null) {
                return left.originalIndex - right.originalIndex;
            }
            if (left.timestamp === null) return 1;
            if (right.timestamp === null) return -1;
            if (left.timestamp !== right.timestamp) return left.timestamp - right.timestamp;
            return left.originalIndex - right.originalIndex;
        })
        .map(entry => entry.log);
}

function cleanWorkflowStateCandidate(value) {
    return normalizeWorkflowText(value)
        .replace(/^[\s"'`]+/, '')
        .replace(/[\s"'`.,!?،؛؟]+$/, '')
        .trim();
}

function getWorkflowAnalysisText(content) {
    return normalizeWorkflowText(content)
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function getNativeWorkflowTarget(log, content) {
    const commentType = normalizeWorkflowText(getWorkflowLogField(log, 'comment_type'));
    if (commentType !== 'Workflow') return '';

    return normalizeWorkflowText(content);
}

function parseExplicitWorkflowTransition(content) {
    const analysisText = getWorkflowAnalysisText(content);

    if (!analysisText) return null;

    const patterns = [
        /^(?:(?:workflow\s+)?state\s+changed|changed)\s+from\s+(.+?)\s+to\s+(.+?)\s*[.!?،؛؟]?$/i,
        /^from\s+(.+?)\s+to\s+(.+?)\s*[.!?،؛؟]?$/i,
        /^(?:تم\s+تغيير\s+حالة\s+سير\s+العمل|تغيير\s+الحالة)\s+من\s+(.+?)\s+إلى\s+(.+?)\s*[.!?،؛؟]?$/u,
        /^من\s+(.+?)\s+إلى\s+(.+?)\s*[.!?،؛؟]?$/u,
        /^(.+?)\s*(?:->|→|←)\s*(.+?)\s*[.!?،؛؟]?$/
    ];

    for (const pattern of patterns) {
        const match = analysisText.match(pattern);
        if (!match) continue;

        const fromState = cleanWorkflowStateCandidate(match[1]);
        const toState = cleanWorkflowStateCandidate(match[2]);
        if (fromState && toState) {
            return { fromState, toState };
        }
    }

    return null;
}

function getWorkflowActor(log) {
    const actorFields = ['owner', 'user', 'completed_by', 'modified_by'];
    let actorId = '';

    for (const fieldname of actorFields) {
        actorId = normalizeWorkflowText(getWorkflowLogField(log, fieldname));
        if (actorId) break;
    }

    if (!actorId) return workflowTranslate('Unknown User');

    try {
        if (typeof frappe !== 'undefined' && typeof frappe.user_info === 'function') {
            const userInfo = frappe.user_info(actorId);
            if (userInfo && typeof userInfo === 'object') {
                const fullname = normalizeWorkflowText(userInfo.fullname || userInfo.full_name);
                if (fullname) return fullname;
            }
        }
    } catch (error) {
        // The actor identifier remains a safe fallback when user metadata is unavailable.
    }

    return actorId;
}

function getWorkflowDateLabels(log) {
    const creation = getWorkflowLogField(log, 'creation');
    const rawCreation = normalizeWorkflowText(creation);
    if (!rawCreation) return null;

    let prettyDate = rawCreation;
    let userDate = rawCreation;

    try {
        if (frappe.datetime && typeof frappe.datetime.prettyDate === 'function') {
            prettyDate = normalizeWorkflowText(frappe.datetime.prettyDate(creation)) || rawCreation;
        }
    } catch (error) {
        prettyDate = rawCreation;
    }

    try {
        if (frappe.datetime && typeof frappe.datetime.str_to_user === 'function') {
            userDate = normalizeWorkflowText(frappe.datetime.str_to_user(creation)) || rawCreation;
        }
    } catch (error) {
        userDate = rawCreation;
    }

    return { prettyDate, userDate };
}

function getWorkflowBranchIcon() {
    try {
        if (frappe.utils && typeof frappe.utils.icon === 'function') {
            return workflowSafeString(frappe.utils.icon('branch', 'sm'));
        }
    } catch (error) {
        // The timeline remains readable when the icon API is unavailable.
    }

    return '';
}

function buildWorkflowCurrentPill() {
    return `
        <span class="indicator-pill green">
            <span class="indicator-dot"></span>
            ${workflowEscapeHtml(workflowTranslate('Current'))}
        </span>
    `;
}

function buildWorkflowTransitionHtml(event) {
    if (event.fromState && event.toState) {
        const arrow = isRTL ? '←' : '→';
        const direction = isRTL ? 'rtl' : 'ltr';
        return `
            <div class="timeline-state-transition text-muted" dir="${direction}">
                <span>${workflowEscapeHtml(workflowTranslate(event.fromState))}</span>
                <span aria-hidden="true">${workflowEscapeHtml(arrow)}</span>
                <span>${workflowEscapeHtml(workflowTranslate(event.toState))}</span>
            </div>
        `;
    }

    if (event.startedIn) {
        return `
            <div class="timeline-state-transition text-muted">
                ${workflowEscapeHtml(workflowTranslate('Started in'))}
                ${workflowEscapeHtml(workflowTranslate(event.startedIn))}
            </div>
        `;
    }

    return '';
}

function buildWorkflowTimelineItem(event, isCurrent) {
    const action = event.action;
    const content = event.content;
    const title = action || content || event.targetState || workflowTranslate('Recorded action');
    const contentHtml = action && content && content !== action
        ? `<div class="timeline-description text-muted">${workflowEscapeHtml(content)}</div>`
        : '';
    const dateHtml = event.dateLabels
        ? `<time class="timeline-date text-muted" title="${workflowEscapeHtml(event.dateLabels.userDate)}">${workflowEscapeHtml(event.dateLabels.prettyDate)}</time>`
        : '';

    return `
        <div class="timeline-item">
            <div class="timeline-dot">${getWorkflowBranchIcon()}</div>
            <div class="timeline-content">
                <div class="timeline-title">
                    <span>${workflowEscapeHtml(workflowTranslate(title))}</span>
                    ${isCurrent ? buildWorkflowCurrentPill() : ''}
                </div>
                ${contentHtml}
                ${buildWorkflowTransitionHtml(event)}
                <div class="timeline-performer text-muted">
                    ${workflowEscapeHtml(workflowTranslate('Performed by'))}:
                    ${workflowEscapeHtml(event.actor)}
                </div>
                ${dateHtml}
            </div>
        </div>
    `;
}

function buildCurrentWorkflowFallbackItem(currentState) {
    return `
        <div class="timeline-item">
            <div class="timeline-dot">${getWorkflowBranchIcon()}</div>
            <div class="timeline-content">
                <div class="timeline-title">
                    <span>
                        ${workflowEscapeHtml(workflowTranslate('Current state:'))}
                        ${workflowEscapeHtml(workflowTranslate(currentState))}
                    </span>
                    ${buildWorkflowCurrentPill()}
                </div>
            </div>
        </div>
    `;
}

function getWorkflowSidebar(frm) {
    const sidebarSelectors = ['.form-sidebar', '.layout-side-section', '.sidebar-menu'];

    if (frm && frm.wrapper) {
        try {
            const $wrapper = $(frm.wrapper);
            for (const selector of sidebarSelectors) {
                const $sidebar = $wrapper.find(selector).first();
                if ($sidebar.length) return $sidebar;
            }
        } catch (error) {
            // Fall through to the native sidebar reference when the wrapper is unavailable.
        }
    }

    if (frm && frm.sidebar) {
        const sidebarCandidates = [
            frm.sidebar.$sidebar,
            frm.sidebar.wrapper,
            frm.sidebar.sidebar,
            frm.sidebar
        ];

        for (const candidate of sidebarCandidates) {
            if (candidate === null || candidate === undefined) continue;

            try {
                const $sidebar = $(candidate).first();
                if ($sidebar.length) return $sidebar;
            } catch (error) {
                // Continue to the next native sidebar candidate.
            }
        }
    }

    return null;
}

function processCompletedWorkflowTransitions(frm) {
    if (!frm || !frm.doc) return;

    const $sidebar = getWorkflowSidebar(frm);
    if (!$sidebar) return;

    $sidebar.find('.workflow-history-section').remove();

    if (frm.doc.__islocal) return;

    const sortedWorkflowLogs = getSortedWorkflowLogs(getWorkflowLogs(frm));
    const events = [];
    let previousKnownState = '';

    sortedWorkflowLogs.forEach((log) => {
        const action = normalizeWorkflowText(getWorkflowLogField(log, 'action'));
        const content = normalizeWorkflowText(getWorkflowLogField(log, 'content'));
        const workflowState = normalizeWorkflowText(getWorkflowLogField(log, 'workflow_state'));
        const stateFallback = normalizeWorkflowText(getWorkflowLogField(log, 'state'));
        if (!action && !content && !workflowState && !stateFallback) return;

        const fieldTargetState = workflowState || stateFallback;
        const nativeTargetState = fieldTargetState
            ? ''
            : getNativeWorkflowTarget(log, content);
        const explicitTransition = fieldTargetState || nativeTargetState
            ? null
            : parseExplicitWorkflowTransition(content);
        const targetState = fieldTargetState
            || nativeTargetState
            || (explicitTransition ? explicitTransition.toState : '');
        let fromState = '';
        let toState = '';
        let startedIn = '';

        if (explicitTransition) {
            fromState = explicitTransition.fromState;
            toState = explicitTransition.toState;
        } else if (targetState) {
            if (previousKnownState && previousKnownState !== targetState) {
                fromState = previousKnownState;
                toState = targetState;
            } else if (!previousKnownState) {
                startedIn = targetState;
            }
        }

        events.push({
            action,
            content,
            actor: getWorkflowActor(log),
            dateLabels: getWorkflowDateLabels(log),
            targetState,
            fromState,
            toState,
            startedIn
        });

        if (targetState) previousKnownState = targetState;
    });

    const currentState = normalizeWorkflowText(frm.doc.workflow_state);
    let currentEventIndex = -1;
    if (currentState) {
        events.forEach((event, index) => {
            if (event.targetState === currentState) currentEventIndex = index;
        });
    }

    const timelineItems = events.map((event, index) => (
        buildWorkflowTimelineItem(event, index === currentEventIndex)
    ));

    if (currentState && currentEventIndex === -1) {
        timelineItems.push(buildCurrentWorkflowFallbackItem(currentState));
    }

    if (!timelineItems.length) return;

    const sectionHtml = `
        <div class="sidebar-section workflow-history-section">
            <div class="sidebar-label">
                <span class="workflow-history-icon">${getWorkflowBranchIcon()}</span>
                <span>${workflowEscapeHtml(workflowTranslate('Workflow Transitions'))}</span>
                <span class="workflow-history-count">${workflowEscapeHtml(timelineItems.length)}</span>
            </div>
            <div class="timeline">
                ${timelineItems.join('')}
            </div>
        </div>
    `;

    $sidebar.append(sectionHtml);
}

function getWorkflowLogs(frm) {
    if (typeof frappe === 'undefined' || !frappe.model || !frappe.model.docinfo) return null;
    const docinfo = frappe.model.docinfo;
    const doctypeKey = frm.doctype || "Payment Requisition";
    const docKey = frm.doc.name;

    return docinfo[doctypeKey]?.[docKey]?.workflow_logs || null;
}

function addUrgentButton(frm) {
    const buttonLabel = __('Mark as Urgent');
    frm.remove_custom_button(buttonLabel);
    frm.remove_custom_button(buttonLabel, __('Actions'));

    if (frm.doc.if_it__urgent === 1) {
        frappe.show_alert({
            message: __('This request is already marked as urgent with reason: {0}', [escapeHtml(frm.doc.reason_of_urgency)]),
            indicator: 'blue'
        }, 5);
        return;
    }

    const btn = frm.add_custom_button(
        buttonLabel,
        () => handleMarkAsUrgent(frm)
    );

    if (btn) {
        btn.removeClass('btn-default btn-secondary').addClass('btn-danger');
    }
}

function handleMarkAsUrgent(frm) {
    if (!frm.perm[0].write) {
        frappe.show_alert({
            message: __('You do not have the necessary permission to modify this document.'),
            indicator: 'red'
        }, 5);
        return;
    }

    const dialog = new frappe.ui.Dialog({
        title: __('Enter Reason for Urgency'),
        fields: [{
            fieldname: 'reason_of_urgency',
            fieldtype: 'Small Text',
            label: __('Marking this request as urgent will notify all concerned parties for immediate action. Please provide a clear justification for the urgency.'),
            reqd: true,
            rows: 4
        }],
        primary_action_label: __('Submit'),
        primary_action(values) {
            if (values.reason_of_urgency) {
                return Promise.resolve()
                    .then(() => frm.set_value('reason_of_urgency', values.reason_of_urgency))
                    .then(() => frm.set_value('if_it__urgent', 1))
                    .then(() => frm.save())
                    .then(() => {
                        frappe.show_alert({
                            message: __('The request has been marked as urgent. An email notification has been sent to all concerned parties.'),
                            indicator: 'green'
                        }, 5);
                        dialog.hide();
                    })
                    .catch(error => {
                        console.error('Unable to mark the request as urgent:', error);
                        frappe.msgprint({
                            title: __('Error'),
                            message: __('Failed to update the request. Please try again.'),
                            indicator: 'red'
                        });
                        return null;
                    });
            }

            return Promise.resolve(null);
        }
    });

    dialog.show();
}

// System Manager tools and imported-data dashboard ----------------------------
function addSystemManagerButtons(frm) {
    const buttonLabel = __('Show Changes');
    frm.remove_custom_button(buttonLabel);
    frm.remove_custom_button(buttonLabel, __('Actions'));

    if (frappe.user.has_role('System Manager')) {
        frm.add_custom_button(buttonLabel, () => show_document_changes_dashboard(frm));
    }
}

function show_document_changes_dashboard(frm) {
    return fetchListRecords('Version', {
        filters: {
            docname: frm.docname,
            ref_doctype: 'Payment Requisition'
        },
        fields: ['creation', 'modified_by', 'data'],
        order_by: 'creation desc',
        limit: 20
    }).then(records => {
        if (!records || !records.length) {
            frappe.msgprint(__('No changes history found for this document.'));
            return;
        }

        const changesTable = createChangesTable(records);
        const dialog = new frappe.ui.Dialog({
            title: __('Document Changes History'),
            size: 'large',
            fields: [
                {
                    fieldtype: 'HTML',
                    fieldname: 'changes_html',
                    options: `<div class="p-2">${changesTable}</div>`
                }
            ]
        });
        dialog.show();
    }).catch(error => {
        console.error('Unable to load document change history:', error);
        frappe.msgprint({
            title: __('Changes History Failed'),
            indicator: 'red',
            message: __('The document changes history could not be loaded. Please try again.')
        });
    });
}

function createChangesTable(versionData) {
    let rowIndex = 1;
    const allRows = [];

    versionData.forEach((version) => {
        let changeDetails;
        try {
            changeDetails = JSON.parse(version.data);
        } catch (error) {
            console.warn('Skipping malformed Version data:', error);
            return;
        }
        const userInfo = frappe.user_info(version.modified_by) || {};
        const fullname = userInfo.fullname || version.modified_by || '-';
        const formattedDate = frappe.datetime.str_to_user(version.creation);

        if (changeDetails && Array.isArray(changeDetails.changed) && changeDetails.changed.length > 0) {
            changeDetails.changed.forEach(change => {
                if (!Array.isArray(change) || change.length < 3) return;

                const [fieldName, oldValue, newValue] = change;
                const formattedFieldName = String(fieldName || '').replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                allRows.push(`
                    <tr>
                        <td class="text-center text-muted">${rowIndex++}</td>
                        <td class="font-weight-bold">${escapeHtml(formattedFieldName)}</td>
                        <td class="text-danger"><del>${escapeHtml(oldValue ?? '-')}</del></td>
                        <td class="text-success font-weight-bold">${escapeHtml(newValue ?? '-')}</td>
                        <td>${escapeHtml(fullname)}</td>
                        <td class="text-muted small">${escapeHtml(formattedDate)}</td>
                    </tr>
                `);
            });
        }
    });

    const tableContent = allRows.length > 0 ? allRows.join('') : '<tr><td colspan="6" class="text-center text-muted p-4">No changes found</td></tr>';
    const headers = `
        <th class="text-center" width="5%">#</th>
        <th width="22%">Field</th>
        <th width="22%">Old Value</th>
        <th width="22%">New Value</th>
        <th width="15%">Modified By</th>
        <th width="14%">Date</th>
    `;

    return build_afmco_table(headers, tableContent);
}

function handlePendingWorkflow(frm) {
    if (frm.doc.workflow_state === 'Pending') {
        import_excel_data(frm);
    }
}

function parsePastedExcelData(input) {
    if (typeof input !== 'string') return null;

    const lines = input.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    if (lines.length < 2) return null;

    const rawHeaders = splitTabularCells(lines[0], false);
    const parsedRows = lines.slice(1)
        .map(line => splitTabularCells(line, false))
        .filter(cells => cells.some(cell => cell.length > 0));

    if (rawHeaders.length === 0 || parsedRows.length === 0) return null;

    const columnCount = Math.max(rawHeaders.length, ...parsedRows.map(cells => cells.length));
    while (rawHeaders.length < columnCount) rawHeaders.push('');

    const headerCounts = new Map();
    const headers = rawHeaders.map((header, index) => {
        const baseHeader = header || `Column ${index + 1}`;
        const occurrence = (headerCounts.get(baseHeader) || 0) + 1;
        headerCounts.set(baseHeader, occurrence);
        return occurrence === 1 ? baseHeader : `${baseHeader} (${occurrence})`;
    });

    const data = parsedRows.map(cells => {
        const row = Object.create(null);
        while (cells.length < headers.length) cells.push('');
        headers.forEach((header, index) => {
            row[header] = cells[index] === '' ? null : cells[index];
        });
        return row;
    });

    return { headers, data };
}

function import_excel_data(frm) {
    const buttonLabel = __('Import Excel Data');
    frm.remove_custom_button(buttonLabel);

    frm.add_custom_button(buttonLabel, function () {
        frappe.prompt(
            [
                {
                    fieldname: 'excel_data',
                    label: __('Paste Excel Data'),
                    fieldtype: 'Text',
                    reqd: true,
                    description: __('Paste data copied from Excel, the first row must contain headers.')
                }
            ],
            function (values) {
                const parsed = parsePastedExcelData(values.excel_data);
                if (!parsed) {
                    frappe.msgprint(__('The data must contain at least one header row and one data row.'));
                    return;
                }

                frm.set_value('data', JSON.stringify(parsed.data, null, 4));
                frm.refresh_field('data');
                frappe.msgprint(__('Data successfully converted and added to the field.'));
                show_data_dashboard(frm);
            },
            __('Paste Excel Data'),
            __('Convert')
        );
    });
}

function showDataDashboard(frm) {
    if (frm.doc.data) {
        show_data_dashboard(frm);
    }
}

function show_data_dashboard(frm) {
    removeAfmcoDashboardSections(frm, '.document-changes-dashboard');

    try {
        const data = JSON.parse(frm.doc.data);
        if (!Array.isArray(data) || data.length === 0) return;

        const dashboardContent = createDataDashboard(data);
        addAlertToDashboard(dashboardContent, frm);

    } catch (error) {
        frappe.msgprint(__('Error parsing data. Please check the format.'));
    }
}

function createDataDashboard(data) {
    const headers = Object.keys(data[0]);
    const tableContent = createDataTable(data, headers);

    return buildAfmcoCollapsibleSection({
        sectionKey: 'document-changes-dashboard',
        wrapperClass: 'document-changes-dashboard custom mb-3',
        title: __('Data Overview'),
        meta: `(${data.length} ${__('Records')})`,
        bodyHtml: tableContent,
        bodyClass: 'pb-0 pt-2',
        collapsedByDefault: true
    });
}

function createDataTable(data, headers) {
    if (!data || !data.length) return '';
    return build_afmco_table(createTableHeaders(headers), createTableRows(data, headers));
}

function createTableHeaders(headers) {
    const dataHeaders = headers.map(header => {
        const formattedHeader = header.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        const icon = getHeaderIcon(header);
        return `<th>${icon ? `<i class="${icon} mx-1"></i>` : ''}${escapeHtml(formattedHeader)}</th>`;
    }).join('');

    return `<th class="text-center text-muted" width="4%">#</th>${dataHeaders}`;
}

function createTableRows(data, headers) {
    if (data.length === 0) {
        return `<tr><td colspan="${headers.length + 1}" class="text-center text-muted p-5">
            <i class="fa fa-inbox fa-3x mb-3 d-block opacity-25"></i>No data found
        </td></tr>`;
    }

    return data.map((row, index) => {
        const rowCells = headers.map(header => createTableCell(row[header], header)).join('');
        return `<tr><td class="text-center font-weight-bold text-muted">${index + 1}</td>${rowCells}</tr>`;
    }).join('');
}

function createTableCell(value, header) {
    const lowerHeader = header.toLowerCase();
    if (value === null || value === undefined || value === '') {
        return '<td class="text-muted fst-italic">-</td>';
    }
    if (lowerHeader.includes('amount') || lowerHeader.includes('price') || lowerHeader.includes('cost')) {
        return `<td class="text-right font-weight-bold text-success">${escapeHtml(format_currency(value))}</td>`;
    }
    if (lowerHeader.includes('date')) {
        return `<td class="text-muted"><i class="fa fa-calendar-alt mx-1"></i>${escapeHtml(value)}</td>`;
    }
    if (lowerHeader.includes('status')) {
        const normalizedValue = String(value).toLowerCase();
        const cls = normalizedValue.includes('inactive') ? 'danger' : normalizedValue.includes('active') ? 'success' : 'info';
        return `<td><span class="badge badge-${cls}">${escapeHtml(value)}</span></td>`;
    }
    return `<td>${escapeHtml(value)}</td>`;
}

function getHeaderIcon(header) {
    const iconMap = {
        'date': 'fa fa-calendar',
        'amount': 'fa fa-money-bill',
        'status': 'fa fa-info-circle',
        'email': 'fa fa-envelope',
        'phone': 'fa fa-phone',
        'name': 'fa fa-user',
        'id': 'fa fa-hashtag',
        'time': 'fa fa-clock'
    };

    const lowerHeader = header.toLowerCase();
    for (const [key, icon] of Object.entries(iconMap)) {
        if (lowerHeader.includes(key)) return icon;
    }
    return '';
}

// Remark parsing and dashboards -----------------------------------------------
function splitTabularCells(line, isPipeTable) {
    const delimiter = isPipeTable ? '|' : '\t';
    const cells = String(line).split(delimiter);

    if (isPipeTable && cells.length > 0 && cells[0].trim() === '') {
        cells.shift();
    }
    if (isPipeTable && cells.length > 0 && cells[cells.length - 1].trim() === '') {
        cells.pop();
    }

    return cells.map(cell => cell.trim());
}

function parseTabularRemarkText(text) {
    if (!text || typeof text !== 'string') return null;

    const lines = text.split(/\r?\n/)
        .map(raw => ({ raw, trimmed: raw.trim() }))
        .filter(line => line.trimmed.length > 0 && !/^[\-\=\_\*\s]{3,}$/.test(line.trimmed));

    if (lines.length < 2) return null;

    let title = '';
    let headerIndex = -1;
    let isPipeTable = false;

    for (let i = 0; i < lines.length; i++) {
        if (lines[i].raw.includes('\t')) {
            headerIndex = i;
            break;
        } else if (
            !/^[\-*]\s*/.test(lines[i].trimmed) &&
            lines[i].raw.includes('|') &&
            splitTabularCells(lines[i].raw, true).filter(cell => cell.length > 0).length >= 2
        ) {
            headerIndex = i;
            isPipeTable = true;
            break;
        }
    }

    if (headerIndex === -1) return null;

    if (headerIndex > 0) {
        const potentialTitle = lines.slice(0, headerIndex).map(line => line.trimmed).join(' ');
        if (potentialTitle.length <= 80) {
            title = potentialTitle;
        }
    }

    const rawHeaders = splitTabularCells(lines[headerIndex].raw, isPipeTable);
    const meaningfulHeaders = rawHeaders.filter(header => header.length > 0 && !/^[\-\=\_\*\s]{2,}$/.test(header));
    const headers = rawHeaders.map((header, index) => header || `Column ${index + 1}`);

    if (headers.length < 2 || meaningfulHeaders.length < 2 || headers.some(header => header.length > 50)) {
        return null;
    }

    const rows = [];
    for (let i = headerIndex + 1; i < lines.length; i++) {
        const cols = splitTabularCells(lines[i].raw, isPipeTable);
        const nonEmptyCols = cols.filter(cell => cell.length > 0);
        const isMarkdownDivider = isPipeTable &&
            nonEmptyCols.length > 0 &&
            nonEmptyCols.every(cell => /^:?-{3,}:?$/.test(cell));

        if (isMarkdownDivider) continue;

        if (cols.some(c => c.length > 0)) {
            while (cols.length < headers.length) cols.push('');
            rows.push(cols.slice(0, headers.length));
        }
    }

    if (!rows.length || !rows.some(r => r.filter(c => c.length > 0).length >= 2)) {
        return null;
    }

    return { title, headers, rows };
}

function parseRepeatedBlocksToTable(text) {
    if (!text || typeof text !== 'string') return null;

    const rawBlocks = text.split(/[\-]{10,}/).map(b => b.trim()).filter(b => b.length > 0);
    const blocks = rawBlocks.length > 0 ? rawBlocks : [text.trim()];

    const parsedBlocks = [];
    const allKeys = new Set();

    blocks.forEach(block => {
        const lines = block.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
        const obj = {};
        let validPairsCount = 0;
        lines.forEach(line => {
            if (/^[\-*]\s*/.test(line)) return;
            if (line.includes(':')) {
                const [key, ...rest] = line.split(':');
                const val = rest.join(':').trim();
                const k = key.trim();
                if (k.length > 0 && k.length <= 40 && val.length > 0) {
                    obj[k] = val;
                    allKeys.add(k);
                    validPairsCount++;
                }
            }
        });
        if (validPairsCount >= 3) {
            parsedBlocks.push(obj);
        }
    });

    if (parsedBlocks.length === 0 || allKeys.size < 3) return null;

    const headers = Array.from(allKeys);

    const rows = parsedBlocks.map(block => {
        return headers.map(h => block[h] || '');
    });

    return { title: 'Employee Data Records', headers, rows };
}

function parseKeyValueRemarkText(text) {
    if (!text || typeof text !== 'string') return null;

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return null;

    const sections = [];
    let currentSection = { title: '', items: [], summary: '' };
    let inSummary = false;

    for (const line of lines) {
        if (/^[\-\=\_\*]{3,}$/.test(line)) continue;

        const summaryMatch = line.match(/^(?:[\-*]\s*)?summary\s*:\s*(.*)$/i);
        if (summaryMatch) {
            const inlineSummary = summaryMatch[1].trim();
            currentSection.summary = inlineSummary;
            inSummary = inlineSummary.length === 0;
            continue;
        }

        if (inSummary) {
            if (line.startsWith('-') || line.startsWith('*')) {
                currentSection.summary = line.replace(/^[\-\*]\s*/, '').trim();
            } else if (line.trim()) {
                currentSection.summary = line.trim();
            }
            inSummary = false;
            continue;
        }

        if (line.startsWith('-') || line.startsWith('*')) {
            const rawItem = line.replace(/^[\-\*]\s*/, '').trim();
            let key = '', val = '';

            if (rawItem.includes(':')) {
                const parts = rawItem.split(':');
                key = parts[0].trim();
                val = parts.slice(1).join(':').trim();
            } else if (rawItem.includes('|')) {
                const parts = rawItem.split('|');
                key = parts[0].trim();
                val = parts.slice(1).join('|').trim();
            }

            if (key && val) {
                currentSection.items.push({ key, val });
            }
        } else {
            if (!currentSection.title) {
                currentSection.title = line.replace(/[:]+$/, '').trim();
            } else if (currentSection.items.length > 0) {
                sections.push(currentSection);
                currentSection = { title: line.replace(/[:]+$/, '').trim(), items: [], summary: '' };
            }
        }
    }

    if (currentSection.items.length > 0) {
        sections.push(currentSection);
    }

    return sections.length > 0 ? sections : null;
}

function renderRemarkExcelDashboard(frm) {
    removeAfmcoDashboardSections(frm, '.remark-excel-dashboard, .remark-keyvalue-dashboard');

    try {
        const remarkText = frm.doc.remark || '';
        if (!remarkText.trim()) return;

        const parsedKV = parseKeyValueRemarkText(remarkText);
        if (parsedKV && parsedKV.length) {
            renderKeyValueDashboardCard(frm, parsedKV);
            return;
        }

        const repeatedData = parseRepeatedBlocksToTable(remarkText);
        if (repeatedData && repeatedData.rows && repeatedData.rows.length) {
            renderExcelDashboardCard(frm, repeatedData);
            return;
        }

        const parsedData = parseTabularRemarkText(remarkText);
        if (parsedData && parsedData.rows && parsedData.rows.length) {
            renderExcelDashboardCard(frm, parsedData);
            return;
        }
    } catch (err) {
        console.warn('[AFMCO Remark Parser] Graceful fallback on unexpected format:', err);
    }
}

function renderExcelDashboardCard(frm, parsedData) {
    const { title, headers, rows } = parsedData;
    const isSingleRow = rows.length === 1;

    let contentHtml = '';

    if (isSingleRow) {
        const row = rows[0];
        const gridItemsHtml = headers.map((h, colIdx) => {
            const val = row[colIdx] || '';
            if (!val || val === '-') return '';
            const lowerH = String(h).toLowerCase();
            let valClass = 'text-dark font-weight-bold';

            if (lowerH.includes('amount') || lowerH.includes('payable') || lowerH.includes('transfer') || lowerH.includes('fee')) {
                valClass = 'text-success font-weight-bold';
            } else if (lowerH.includes('deduction')) {
                valClass = 'text-danger font-weight-bold';
            }

            return `
                <div class="col-md-6 mb-2">
                    <div class="d-flex justify-content-between p-2 rounded" style="background-color: var(--control-bg);">
                        <span class="text-muted small">${escapeHtml(__(h))}:</span>
                        <span class="${valClass} small text-nowrap">${escapeHtml(val)}</span>
                    </div>
                </div>
            `;
        }).filter(item => item.length > 0).join('');

        contentHtml = `
            <div class="row pt-2">
                ${gridItemsHtml}
            </div>
        `;
    } else {
        const tableHeadersHtml = headers.map(h => {
            return `<th class="text-muted text-nowrap">${escapeHtml(__(h))}</th>`;
        }).join('');

        const tableRowsHtml = rows.map((row, idx) => {
            const cellsHtml = headers.map((h, colIdx) => {
                const val = row[colIdx] || '-';
                const lowerH = String(h).toLowerCase();

                if (lowerH.includes('amount') || lowerH.includes('payable') || lowerH.includes('transfer') || lowerH.includes('deduction') || lowerH.includes('fee')) {
                    return `<td class="text-right font-weight-bold text-nowrap">${escapeHtml(val)}</td>`;
                }
                if (lowerH.includes('account') || lowerH.includes('iban')) {
                    const cleanedIban = String(val).replace(/[\s\-_]+/g, '').toUpperCase();
                    return `<td class="font-monospace text-nowrap">${escapeHtml(cleanedIban || val)}</td>`;
                }
                return `<td class="text-nowrap">${escapeHtml(val)}</td>`;
            }).join('');

            return `<tr><td class="text-center text-muted">${idx + 1}</td>${cellsHtml}</tr>`;
        }).join('');

        const fullHeaders = `<th class="text-center text-muted" width="4%">#</th>${tableHeadersHtml}`;
        contentHtml = build_afmco_table(fullHeaders, tableRowsHtml);
    }

    const displayTitle = title || (isSingleRow ? __('Record Details') : __('Data Records'));
    const dashboardHtml = buildAfmcoCollapsibleSection({
        sectionKey: 'remark-excel-dashboard',
        wrapperClass: 'remark-excel-dashboard custom mb-3',
        title: displayTitle,
        meta: `(${rows.length} ${rows.length === 1 ? __('Record') : __('Records')})`,
        bodyHtml: contentHtml,
        bodyClass: 'pb-0 pt-2',
        collapsedByDefault: true
    });

    appendAfmcoDashboardSection(frm, dashboardHtml);
}

function renderKeyValueDashboardCard(frm, sections) {
    removeAfmcoDashboardSections(frm, '.remark-keyvalue-dashboard');

    const sectionsHtml = sections.map((sec, index) => {
        const itemsHtml = sec.items.map(item => {
            const kLower = String(item.key).toLowerCase();
            let valFormatted = item.val;
            let valClass = 'text-dark';

            if (kLower.includes('salary') || kLower.includes('amount') || kLower.includes('eos') || kLower.includes('allowance') || kLower.includes('reward')) {
                const isNum = !isNaN(parseFloat(item.val.replace(/,/g, '')));
                if (isNum) {
                    valFormatted = format_currency(parseFloat(item.val.replace(/,/g, '')));
                }
                valClass = 'font-weight-bold text-success';
            } else if (kLower.includes('deduction')) {
                valClass = 'font-weight-bold text-danger';
            }

            return `
                <div class="col-md-6 mb-2">
                    <div class="d-flex justify-content-between p-2 rounded" style="background-color: var(--control-bg);">
                        <span class="text-muted small">${escapeHtml(__(item.key))}</span>
                        <span class="${valClass} small">${escapeHtml(valFormatted)}</span>
                    </div>
                </div>
            `;
        }).join('');

        const summaryHtml = sec.summary ? `
            <div class="mt-2 text-muted small px-2">
                <strong>${__('Formula')}:</strong> <span class="font-monospace">${escapeHtml(sec.summary)}</span>
            </div>
        ` : '';

        const displayTitle = sec.title ? __(sec.title) : __('Request Breakdown');

        return buildAfmcoCollapsibleSection({
            sectionKey: `remark-keyvalue-section-${index}`,
            wrapperClass: 'mb-3',
            title: displayTitle,
            meta: `(${sec.items.length} ${__('Fields')})`,
            bodyClass: 'pb-2 pt-2',
            collapsedByDefault: true,
            bodyHtml: `
                <div class="row px-2 pt-2">
                    ${itemsHtml}
                </div>
                ${summaryHtml}
            `
        });
    }).join('');

    const dashboardHtml = `
        <div class="remark-keyvalue-dashboard custom mb-3">
            ${sectionsHtml}
        </div>
    `;

    appendAfmcoDashboardSection(frm, dashboardHtml);
}

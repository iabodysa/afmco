frappe.ui.form.on('Journal Entry', {
    expense_request_cf(frm) {
        er_status(frm);
        er_remove_section(frm);
    },
    refresh(frm) {
        er_remove_section(frm); 
        er_status(frm);
        er_buttons(frm);
        je_attachments(frm);
        // Don't load details automatically to improve performance
    }
});

const DT_ER = 'Payment Requisition';
const DT_CM = 'Comment';

function er_buttons(frm) {
    frm.clear_custom_buttons();
    if (frm.doc.docstatus === 1) {
        frm.add_custom_button(__('Cancellation Request'), () => {
            const d = new frappe.ui.Dialog({
                title: __('Cancellation Request'),
                fields: [{ fieldname: 'reason', fieldtype: 'Small Text', label: __('Cancellation Reason'), reqd: 1 }],
                primary_action_label: __('Submit'),
                primary_action: v => {
                    d.set_primary_action(__('Submitting...'));
                    d.disable_primary_action();
                    frappe.call({
                        method: 'frappe.client.insert',
                        freeze: true,
                        args: {
                            doc: {
                                doctype: 'Cancellation Request',
                                cancellation_reason: v.reason,
                                journal_entry: frm.doc.name,
                                requested_by: frappe.session.user,
                                request_date: frappe.datetime.now_datetime()
                            }
                        }
                    }).then(() => {
                        frappe.show_alert({ message: __('Cancellation Request created successfully.'), indicator: 'green' });
                        d.hide();
                    }).finally(() => {
                        d.enable_primary_action();
                        d.set_primary_action(__('Submit'));
                    });
                }
            });
            d.show();
        }, __('Actions'));
    }
}

function er_load_details(frm) {
    if (!frm.doc.expense_request_cf) {
        frappe.show_alert({ message: __('Please select a Payment Request first'), indicator: 'orange' });
        return;
    }
    
    frappe.show_alert({ message: __('Loading details...'), indicator: 'blue' });
    er_details(frm);
}

function er_status(frm) {

    if (!frm.doc.expense_request_cf) {
        frm.dashboard.hide();
        return;
    }

    frappe.db.get_value(DT_ER, { name: frm.doc.expense_request_cf }, ['workflow_state']).then(r => {
        if (!r.message) {
            frm.dashboard.hide();
            return;
        }
        const s = r.message.workflow_state || '';
        const color = er_color(s);
        const html = `
            <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                <div>
                    <span class="indicator ${color}"></span>
                    <span style="margin-left: 8px;">${__('Payment Request')}: <strong>${s}</strong></span>
                </div>
                <button class="btn btn-xs btn-default" onclick="return false;" id="er-fetch-details-btn">
                    <svg class="icon icon-xs" style="margin-right: 4px;">
                        <use href="#icon-refresh"></use>
                    </svg>
                    ${__('Fetch Details')}
                </button>
            </div>
        `;
        frm.dashboard.set_headline(html);
        frm.dashboard.show();
        
        // Add click handler for the button
        setTimeout(() => {
            $('#er-fetch-details-btn').off('click').on('click', function(e) {
                e.preventDefault();
                er_load_details(frm);
            });
        }, 100);
    }).catch(() => {
        frm.dashboard.hide();
    });
}

function er_color(s) {
    const k = (s || '').toLowerCase();
    const m = { 
        paid: 'green',
        approved: 'green', 
        submitted: 'blue', 
        pending: 'orange', 
        rejected: 'red', 
        draft: 'gray'
    };
    return m[k] || 'orange';
}

function er_remove_section(frm) {
    if (frm.er_details_wrapper) {
        frm.er_details_wrapper.remove();
        frm.er_details_wrapper = null;
    }
}

function er_details(frm) {
    // Remove existing section
    er_remove_section(frm);
    
    if (!frm.doc.expense_request_cf) {
        return;
    }

    // Create Frappe-style collapsible section
    const wrapper = $(`
        <div class="row form-section card-section visible-section">
            <div class="section-head collapsible">
                ${__('Payment Request Details')}
                <span class="ml-2 collapse-indicator mb-1">
                    <svg class="es-icon es-line icon-sm" aria-hidden="true">
                        <use class="mb-1" href="#es-line-down"></use>
                    </svg>
                </span>
            </div>
            <div class="section-body hide">
                <div class="form-column col-sm-12">
                    <div class="frappe-control">
                        <div class="form-group">
                            <div class="control-value">
                                <div class="er-details-content text-muted">
                                    ${__('Loading...')}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `);
    
    // Insert after dashboard (at the beginning of the form)
    const dashboard = frm.$wrapper.find('.form-dashboard');
    if (dashboard.length) {
        wrapper.insertAfter(dashboard);
    } else {
        // Fallback: insert at the beginning of form layout
        wrapper.insertBefore(frm.$wrapper.find('.form-section:first'));
    }
    
    frm.er_details_wrapper = wrapper;
    
    // Add collapse toggle functionality
    wrapper.find('.section-head').on('click', function() {
        const $head = $(this);
        const $body = wrapper.find('.section-body');
        const $indicator = $head.find('use');
        
        if ($body.hasClass('hide')) {
            $body.removeClass('hide');
            $head.removeClass('collapsed');
            $indicator.attr('href', '#es-line-up');
        } else {
            $body.addClass('hide');
            $head.addClass('collapsed');
            $indicator.attr('href', '#es-line-down');
        }
    });
    
    // Load data
    frappe.db.get_list(DT_CM, {
        filters: { reference_doctype: DT_ER, reference_name: frm.doc.expense_request_cf },
        fields: ['comment_type', 'content', 'owner', 'creation', 'comment_by'],
        order_by: 'creation asc'
    }).then(rows => {
        er_fill(wrapper.find('.er-details-content'), rows);
        // Auto-expand section after loading
        wrapper.find('.section-body').removeClass('hide');
        wrapper.find('.section-head').removeClass('collapsed');
        wrapper.find('use').attr('href', '#es-line-up');
        frappe.show_alert({ message: __('Details loaded successfully'), indicator: 'green' });
    }).catch(() => {
        wrapper.find('.er-details-content').html(
            `<div class="text-danger">${__('Failed to load details')}</div>`
        );
        frappe.show_alert({ message: __('Failed to load details'), indicator: 'red' });
    });
}
/**
 * This function creates the main professional, collapsible card container for the details.
 * It is responsible for the overall structure and calls er_fill to populate the content.
 */
function er_details(frm) {
    // Remove existing section to prevent duplicates
    er_remove_section(frm);
    
    if (!frm.doc.expense_request_cf) {
        return;
    }

    // Create a modern, card-style collapsible section
    const wrapper = $(`
        <div class="form-section card-section frappe-card" style="margin-bottom: 20px; border: 1px solid #d1d8dd; border-radius: 6px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);">
            
            <div class="section-head" style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background-color: #f8f9fa; border-bottom: 1px solid #d1d8dd; cursor: pointer;">
                <div style="font-weight: 600; color: #495057; font-size: 14px;">
                    ${__('Payment Request Details')}
                </div>
                <span class="collapse-indicator">
                    <svg class="icon icon-sm text-muted"><use href="#icon-chevron-down"></use></svg>
                </span>
            </div>
            
            <div class="section-body hide" style="padding: 15px;">
                <div class="er-details-content text-muted" style="min-height: 50px;">
                    <div class="text-center my-4">${__('Loading...')}</div>
                </div>
            </div>
            
        </div>
    `);
    
    // Insert the new section after the dashboard
    const dashboard = frm.$wrapper.find('.form-dashboard');
    if (dashboard.length) {
        wrapper.insertAfter(dashboard);
    } else {
        wrapper.insertBefore(frm.$wrapper.find('.form-layout:first'));
    }
    
    frm.er_details_wrapper = wrapper;
    
    // Add collapse toggle functionality
    wrapper.find('.section-head').on('click', function() {
        const $body = wrapper.find('.section-body');
        const $indicator = wrapper.find('.collapse-indicator use');
        
        $body.toggleClass('hide');
        
        if ($body.hasClass('hide')) {
            $indicator.attr('href', '#icon-chevron-down');
        } else {
            $indicator.attr('href', '#icon-chevron-up');
        }
    });
    
    // Load data into the section
    frappe.db.get_list('Comment', {
        filters: { reference_doctype: 'Payment Requisition', reference_name: frm.doc.expense_request_cf },
        fields: ['comment_type', 'content', 'owner', 'creation', 'comment_by'],
        order_by: 'creation asc'
    }).then(rows => {
        er_fill(wrapper.find('.er-details-content'), rows);
        
        // Auto-expand section after details are loaded successfully
        if (wrapper.find('.section-body').hasClass('hide')) {
            wrapper.find('.section-head').trigger('click');
        }
        frappe.show_alert({ message: __('Details loaded successfully'), indicator: 'green' });

    }).catch(() => {
        wrapper.find('.er-details-content').html(
            `<div class="text-danger">${__('Failed to load details')}</div>`
        );
        frappe.show_alert({ message: __('Failed to load details'), indicator: 'red' });
    });
}


/**
 * This function populates the container with the workflow timeline and comments.
 * It is responsible for rendering the actual content.
 */
function er_fill($container, rows) {
    const appr = rows.filter(x => x.comment_type === 'Workflow');
    const comm = rows.filter(x => x.comment_type === 'Comment');

    let html = `<div class="row">`;

    // ## WORKFLOW TIMELINE SECTION ##
    html += `
        <div class="col-md-6">
            <h6 class="text-muted uppercase" style="font-size: 11px; letter-spacing: 0.5px; margin-bottom: 25px;">
                <svg class="icon icon-xs" style="margin-right: 5px;"><use href="#icon-workflow"></use></svg>
                ${__('WORKFLOW HISTORY')}
            </h6>
            <div class="timeline-container" style="position: relative;">`;

    if (appr.length) {
        // The vertical timeline bar
        html += `<div style="position: absolute; left: 15px; top: 5px; width: 2px; height: calc(100% - 20px); background-color: #e2e8f0;"></div>`;

        appr.forEach((x, idx) => {
            const who = x.comment_by || x.owner || '';
            const when = frappe.datetime.str_to_user(x.creation);
            const txt = x.content || '';
            const relativeTime = frappe.datetime.comment_when(x.creation);
            
            let actionText = __('updated the status');
            let icon = 'icon-play';
            let color = '#475569'; // Gray

            if (txt.toLowerCase().includes('reject')) {
                actionText = __('rejected');
                icon = 'icon-close';
                color = '#dc3545'; // Red
            } else if (idx === 0) {
                actionText = __('submitted');
                icon = 'icon-arrow-up';
                color = '#0d6efd'; // Blue
            } else {
                 actionText = __('approved');
                 icon = 'icon-check';
                 color = '#198754'; // Green
            }

            html += `
                <div class="timeline-item" style="position: relative; display: flex; align-items: flex-start; margin-bottom: 25px;">
                    <div class="timeline-dot" style="width: 32px; height: 32px; border-radius: 50%; background-color: ${color}; color: white; display: flex; align-items: center; justify-content: center; flex-shrink: 0; border: 3px solid white; z-index: 1;">
                        <svg class="icon icon-sm"><use href="#${icon}"></use></svg>
                    </div>
                    <div class="timeline-content" style="margin-left: 15px; padding-top: 5px;">
                        <div style="font-weight: 500; color: #343a40;">
                            <strong>${who}</strong>
                            <span class="text-muted">${actionText}</span>
                        </div>
                        <div style="font-size: 12px; color: #6c757d;" title="${when}">${relativeTime}</div>
                        <div class="status-chip" style="margin-top: 5px; display: inline-block; background-color: #f1f3f5; color: #495057; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 500;">
                           ${txt}
                        </div>
                    </div>
                </div>`;
        });
    } else {
        html += `<div class="text-center text-muted p-4" style="background-color: #f8f9fa; border-radius: 6px;">${__('No workflow history available')}</div>`;
    }

    html += `</div></div>`; // End Workflow Column

    // ## COMMENTS SECTION ##
    html += `
        <div class="col-md-6">
            <h6 class="text-muted uppercase" style="font-size: 11px; letter-spacing: 0.5px; margin-bottom: 25px;">
                <svg class="icon icon-xs" style="margin-right: 5px;"><use href="#icon-message-1"></use></svg>
                ${__('COMMENTS')}
            </h6>
            <div class="comments-list">`;
    
    if (comm.length) {
        comm.forEach(x => {
            const who = x.comment_by || x.owner || '';
            const when = frappe.datetime.str_to_user(x.creation);
            const relativeTime = frappe.datetime.comment_when(x.creation);
            let txt = x.content || '';

            if (txt.includes('<div') || txt.includes('<p>')) {
                txt = $('<div>').html(txt).text().trim();
            }

            html += `
                <div class="comment-bubble" style="display: flex; align-items: flex-start; margin-bottom: 15px;">
                    <div style="width: 36px; height: 36px; background: #e9ecef; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin-right: 12px; flex-shrink: 0;">
                         <svg class="icon icon-sm text-muted"><use href="#icon-user"></use></svg>
                    </div>
                    <div style="background: #f8f9fa; border: 1px solid #dee2e6; border-radius: 12px; padding: 10px 15px; flex-grow: 1;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                            <div style="font-weight: bold; font-size: 13px; color: #212529;">${who}</div>
                            <div style="font-size: 11px; color: #6c757d;" title="${when}">${relativeTime}</div>
                        </div>
                        <div style="color: #495057; font-size: 14px; line-height: 1.6; word-wrap: break-word;">
                            ${txt}
                        </div>
                    </div>
                </div>`;
        });
    } else {
        html += `<div class="text-center text-muted p-4" style="background-color: #f8f9fa; border-radius: 6px;">${__('No comments yet')}</div>`;
    }
    
    html += `</div></div>`; // End Comments Column

    html += `</div>`; // End Row

    $container.removeClass('text-muted').html(html);
}


// Attachments of the entry and its Payment Requisition, shown beside the form in a split view
const JE_IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'];

function je_attachments(frm) {
    frm.je_files = [];
    if (frm.is_new()) {
        je_split_close();
        return;
    }
    if (!frm.je_split_btn) {
        frm.je_split_btn = frm.page.add_action_icon('attachment', () => je_split_toggle(frm), '', __('Attachments View'));
    }
    if (je_split_is_open()) je_load_files(frm).then(() => je_split_render(frm));
}

function je_load_files(frm) {
    const name = frm.doc.name;
    return frappe.xcall('afmco.financial_operations.api.journal_entry.get_attachments', { name }).then(files => {
        if (frm.doc.name === name) frm.je_files = files || [];
    });
}

function je_file_buttons(frm, $list, active) {
    frm.je_files.forEach((file, idx) => {
        const source = file.attached_to_doctype === 'Journal Entry' ? __('Journal Entry') : __('Payment Requisition');
        $(`<button type="button" class="btn btn-sm ${idx === active ? 'btn-primary' : 'btn-default'}"></button>`)
            .append($('<span></span>').text(file.file_name || file.file_url))
            .append($('<span style="margin-inline-start: 6px; opacity: 0.7;"></span>').text(source))
            .on('click', () => je_split_open(frm, idx))
            .appendTo($list);
    });
}

function je_split_is_open() {
    return document.body.classList.contains('je-split');
}

function je_split_toggle(frm) {
    if (je_split_is_open()) {
        je_split_close();
    } else {
        je_split_open(frm, 0);
    }
}

function je_split_open(frm, idx) {
    frm.je_split_index = idx || 0;
    if (!je_split_is_open()) {
        frm.je_files = null;
        je_load_files(frm).then(() => je_split_is_open() && je_split_render(frm));
        je_split_style();
        const sidebar = frappe.app && frappe.app.sidebar;
        document.body.dataset.jeSidebarWasOpen = sidebar && sidebar.sidebar_expanded ? '1' : '';
        if (sidebar && sidebar.sidebar_expanded) sidebar.close();
        document.body.classList.add('je-split');
        $('<div class="je-split-panel"></div>').appendTo('body');
        frappe.router.once('change', je_split_close);
    }
    je_split_render(frm);
}

function je_split_close() {
    if (!je_split_is_open()) return;
    document.body.classList.remove('je-split');
    $('.je-split-panel').remove();
    const sidebar = frappe.app && frappe.app.sidebar;
    if (sidebar && document.body.dataset.jeSidebarWasOpen && !sidebar.sidebar_expanded) sidebar.open();
    delete document.body.dataset.jeSidebarWasOpen;
}

function je_split_render(frm) {
    const $panel = $('.je-split-panel').empty();
    const top = ($('.navbar').outerHeight() || 0);
    $panel.css('top', top + 'px');

    const $head = $('<div class="je-split-head"></div>').appendTo($panel);
    const $files = $('<div class="je-split-files"></div>').appendTo($head);
    $(`<button type="button" class="btn btn-default btn-sm icon-btn" title="${__('Close')}">${frappe.utils.icon('close', 'sm')}</button>`)
        .on('click', je_split_close)
        .appendTo($head);

    const $body = $('<div class="je-split-body"></div>').appendTo($panel);
    if (!frm.je_files) {
        $body.append($('<div class="text-muted" style="padding: 24px;"></div>').text(__('Loading...')));
        return;
    }
    if (!frm.je_files.length) {
        $body.append($('<div class="text-muted" style="padding: 24px;"></div>').text(__('No attachments')));
        return;
    }
    const idx = Math.min(frm.je_split_index || 0, frm.je_files.length - 1);
    je_file_buttons(frm, $files, idx);

    const file = frm.je_files[idx];
    const url = encodeURI(file.file_url);
    const ext = (file.file_url.split('?')[0].split('.').pop() || '').toLowerCase();
    if (JE_IMAGE_EXT.includes(ext)) {
        $body.append($('<img style="max-width: 100%; display: block; margin: auto;">').attr('src', url));
    } else if (ext === 'pdf') {
        $body.append($('<iframe style="width: 100%; height: 100%; border: 0;"></iframe>').attr('src', url));
    } else {
        $body.append(
            $('<div style="padding: 24px;"></div>').append(
                $('<a class="btn btn-default btn-sm" target="_blank" rel="noopener"></a>').attr('href', url).text(__('Open in New Tab'))
            )
        );
    }
}

function je_split_style() {
    if (document.getElementById('je-split-style')) return;
    $(`<style id="je-split-style">
        body.je-split .page-container { margin-inline-end: 50vw; }
        body.je-split .layout-side-section { display: none !important; }
        .je-split-panel {
            position: fixed; inset-inline-end: 0; bottom: 0; width: 50vw; z-index: 1020;
            display: flex; flex-direction: column;
            background: var(--card-bg); border-inline-start: 1px solid var(--border-color);
        }
        .je-split-head { display: flex; gap: 8px; align-items: flex-start; padding: 8px; border-bottom: 1px solid var(--border-color); }
        .je-split-files { display: flex; flex-wrap: wrap; gap: 6px; flex: 1; }
        .je-split-body { flex: 1; overflow: auto; }
    </style>`).appendTo('head');
}

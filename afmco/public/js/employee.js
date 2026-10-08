frappe.ui.form.on('Employee', {
    refresh: function(frm) {
        frm.page.add_menu_item(__('Download Employee Card'), function() {
            create_card_image(frm);
        });
    }
});

function employee_card_id(frm) {
    return frm.doc.id_number_cf || frm.doc.name;
}

function create_card_image(frm) {
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');

    // Professional ID card dimensions
    canvas.width = 420;
    canvas.height = 660;

    // Background - clean white
    ctx.fillStyle = '#F8F5EE';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw geometric pattern background
    drawGeometricPattern(ctx);

    // Main card area with rounded corners
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, 30, 30, 360, 600, 20);
    ctx.fill();

    // Header accent bar
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, 30, 30, 360, 120, [20, 20, 0, 0]);
    ctx.fill();

    // Add green accent stripe at bottom of header
    ctx.fillStyle = '#00844E';
    ctx.fillRect(30, 140, 360, 10);

    // Load and draw elements
    let logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = function() {
        // Logo on white background
        ctx.drawImage(logoImg, 160, 55, 100, 50);
        continueCardCreation();
    };
    logoImg.onerror = function() {
        // Company name if no logo
        ctx.fillStyle = '#072B1A';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('COMPANY', 210, 85);
        continueCardCreation();
    };
    logoImg.src = frappe.urllib.get_full_url('/files/Logo-01.png');

    function continueCardCreation() {
        // Employee photo section
        let employeeImg = new Image();
        employeeImg.crossOrigin = 'anonymous';
        employeeImg.onload = function() {
            drawModernLayout(ctx, employeeImg, frm);
            saveCanvasAsAttachment(canvas, frm);
        };
        employeeImg.onerror = function() {
            drawModernLayout(ctx, null, frm);
            saveCanvasAsAttachment(canvas, frm);
        };
        employeeImg.src = frm.doc.image || frappe.urllib.get_full_url('/files/avatar.jpg');
    }
}

function drawGeometricPattern(ctx) {
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;

    // Hexagonal pattern in background
    for(let y = 0; y < 660; y += 60) {
        for(let x = 0; x < 420; x += 52) {
            let offsetX = (y / 60) % 2 === 0 ? 0 : 26;
            drawHexagon(ctx, x + offsetX, y, 25);
        }
    }
    ctx.globalAlpha = 1;
}

function drawHexagon(ctx, x, y, size) {
    ctx.beginPath();
    for(let i = 0; i < 6; i++) {
        let angle = (Math.PI / 3) * i;
        let px = x + size * Math.cos(angle);
        let py = y + size * Math.sin(angle);
        if(i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
}

function drawModernLayout(ctx, img, frm) {
    // Circular photo frame
    let photoX = 210;
    let photoY = 250;
    let photoRadius = 80;

    // Photo background circle
    ctx.fillStyle = '#00844E';
    ctx.beginPath();
    ctx.arc(photoX, photoY, photoRadius + 5, 0, Math.PI * 2);
    ctx.fill();

    // White border
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(photoX, photoY, photoRadius + 2, 0, Math.PI * 2);
    ctx.fill();

    if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(photoX, photoY, photoRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, photoX - photoRadius, photoY - photoRadius, photoRadius * 2, photoRadius * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = '#dddddd';
        ctx.beginPath();
        ctx.arc(photoX, photoY, photoRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#072B1A';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Photo', photoX, photoY + 5);
    }

    // Employee name
    ctx.fillStyle = '#072B1A';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    let name = frm.doc.employee_name || 'Employee Name';
    ctx.fillText(name.toUpperCase(), 210, 370);

    // Designation
    ctx.font = '20px Arial';
    ctx.fillStyle = '#00844E';
    ctx.fillText(frm.doc.designation || 'Position', 210, 400);

    // Divider line
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(60, 430);
    ctx.lineTo(360, 430);
    ctx.stroke();

    // ID Number only
    drawInfoCard(ctx, 60, 460, 'ID NUMBER', employee_card_id(frm), '#072B1A');

    // Footer section
    ctx.fillStyle = '#072B1A';
    roundedRect(ctx, 30, 560, 360, 70, [0, 0, 20, 20]);
    ctx.fill();

    // Footer text
    ctx.fillStyle = '#60d297';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('This card is property of the company', 210, 590);
    ctx.fillText('Please return if found', 210, 610);
}

function drawInfoCard(ctx, x, y, label, value, color) {
    // Label
    ctx.fillStyle = '#000000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y);

    // Value box
    ctx.fillStyle = '#dddddd';
    roundedRect(ctx, x, y + 10, 300, 50, 8);
    ctx.fill();

    // Value text
    ctx.fillStyle = '#072B1A';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(value || 'N/A', 210, y + 40);
}

function drawQRPattern(ctx, x, y, size) {
    // Simple QR code pattern
    ctx.fillStyle = '#000000';
    let cellSize = size / 7;
    for(let i = 0; i < 7; i++) {
        for(let j = 0; j < 7; j++) {
            if(Math.random() > 0.5 || (i < 2 && j < 2) || (i > 4 && j < 2) || (i < 2 && j > 4)) {
                ctx.fillRect(x + i * cellSize, y + j * cellSize, cellSize - 1, cellSize - 1);
            }
        }
    }
}

function roundedRect(ctx, x, y, width, height, radius) {
    if (typeof radius === 'number') {
        radius = [radius, radius, radius, radius];
    }
    ctx.beginPath();
    ctx.moveTo(x + radius[0], y);
    ctx.lineTo(x + width - radius[1], y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius[1]);
    ctx.lineTo(x + width, y + height - radius[2]);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius[2], y + height);
    ctx.lineTo(x + radius[3], y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius[3]);
    ctx.lineTo(x, y + radius[0]);
    ctx.quadraticCurveTo(x, y, x + radius[0], y);
    ctx.closePath();
}

function saveCanvasAsAttachment(canvas, frm) {
    canvas.toBlob(function(blob) {
        let filename = `employee_id_card_${employee_card_id(frm)}_${new Date().getTime()}.png`;

        let formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('doctype', frm.doc.doctype);
        formData.append('docname', frm.doc.name);
        formData.append('is_private', 0);

        let xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/method/frappe.handler.upload_file');
        xhr.setRequestHeader('X-Frappe-CSRF-Token', frappe.csrf_token);

        xhr.onload = function() {
            if (xhr.status === 200) {
                let response = JSON.parse(xhr.responseText);
                if (response.message) {
                    frappe.msgprint(__('Employee card saved to attachments successfully'));
                    frm.reload_doc();
                }
            } else {
                frappe.msgprint(__('Error occurred while saving the card'));
            }
        };

        xhr.onerror = function() {
            frappe.msgprint(__('Error occurred while saving the card'));
        };

        xhr.send(formData);
    }, 'image/png');
}


frappe.ui.form.on('Employee', {
    refresh: function(frm) {
        if (frm.doc.status === 'Active') {
            addOpeningLeaveAllocationButton(frm);
        }

        if (frappe.user.has_role('General Manager')) {
            addEmployeeDuesButton(frm);
        }

        handleIqamaExpiredStatus(frm);
        displayIqamaExpiredAlert(frm);

        renderMuqeemDashboard(frm);
    }
});


function renderMuqeemDashboard(frm) {
    if (frm.doc.__islocal) return;
    
    const isAdmin = frappe.user.has_role("System Manager");
    const isHRManager = frappe.user.has_role("HR Manager");

    if (!isAdmin && !isHRManager) {
        return; 
    }

    const canVisa = frappe.model.can_read('Employee Visa');
    const canIns  = frappe.model.can_read('Employee Insurance');
    const canDep  = frappe.model.can_read('Employee Dependent');
    if (!canVisa && !canIns && !canDep) return;

    const seq = frm._mq_dash_seq = (frm._mq_dash_seq || 0) + 1;

    Promise.all([
        canVisa ? frappe.db.get_list('Employee Visa', {
            filters: { employee: frm.doc.name },
            fields: ['name', 'visa_number', 'visa_type', 'visa_status', 'visa_issue_date',
                     'travel_before', 'return_before', 'visa_duration'],
            order_by: 'visa_issue_date desc',
            limit: 20
        }) : Promise.resolve(null),
        canIns ? frappe.db.get_list('Employee Insurance', {
            filters: { employee: frm.doc.name },
            fields: ['name', 'policy_number', 'company_name', 'start_date', 'end_date'],
            order_by: 'end_date desc',
            limit: 5
        }) : Promise.resolve(null),
        canDep ? frappe.db.get_list('Employee Dependent', {
            filters: { employee: frm.doc.name },
            fields: ['name', 'full_name', 'relationship', 'iqama_expiry_date', 'status', 'outside_kingdom'],
            order_by: 'iqama_expiry_date asc',
            limit: 20
        }) : Promise.resolve(null)
    ]).then(([visas, insurances, dependents]) => {
        if (seq !== frm._mq_dash_seq) return;

        const html = buildMuqeemDashboardHTML(frm, visas || [], insurances || [], dependents || []);

        frm.dashboard.parent.find('.mq-dash-section').remove();
        const body = frm.dashboard.add_section(html, __('Muqeem — Visas, Insurance and Dependents', null, 'Employee'));
        if (body && body.closest) body.closest('.form-dashboard-section').addClass('mq-dash-section');
        frm.dashboard.show();
    });
}

function buildMuqeemDashboardHTML(frm, visas, insurances, dependents) {
    const esc = (t) => (frappe.utils.escape_html ? frappe.utils.escape_html(String(t ?? '')) : String(t ?? ''));
    const du = (d) => (d ? frappe.datetime.str_to_user(d) : '—');
    const today = frappe.datetime.get_today();

    const pill = (text, color) =>
        `<span class="indicator-pill whitespace-nowrap ${color}" style="margin-inline-end:8px;margin-bottom:6px;"><span>${text}</span></span>`;

    let pills = '';
    const balance = frm.doc.custom_muqeem_balance;
    if (balance !== undefined && balance !== null) {
        pills += pill(__('Muqeem balance: {0}', [esc(balance)], 'Employee'), balance > 0 ? 'blue' : 'gray');
    }
    const vCount = frm.doc.custom_muqeem_violations_count || 0;
    const vCost = frm.doc.custom_muqeem_violations_cost || 0;
    pills += pill(__('Violations: {0}', [esc(vCount)], 'Employee'), vCount > 0 ? 'red' : 'green');
    if (vCount > 0) pills += pill(__('Amount: {0} SAR', [esc(format_number(vCost, null, 0))], 'Employee'), 'orange');

    const ins = insurances.length ? insurances[0] : null;
    if (ins && ins.end_date) {
        const daysLeft = frappe.datetime.get_day_diff(ins.end_date, today);
        const color = daysLeft < 0 ? 'red' : (daysLeft <= 30 ? 'orange' : 'green');
        const label = daysLeft < 0
            ? __('Insurance expired on {0}', [du(ins.end_date)], 'Employee')
            : __('Insured until {0}', [du(ins.end_date)], 'Employee');
        pills += pill(label, color);
    }
    if (dependents.length) pills += pill(__('Dependents: {0}', [dependents.length], 'Employee'), 'blue');
    if (visas.length) pills += pill(__('Visas: {0}', [visas.length], 'Employee'), 'blue');

    let html = `<div class="mq-dash" style="width:100%;">`;
    html += `<div style="display:flex;flex-wrap:wrap;align-items:center;margin-bottom:10px;">${pills}</div>`;

    if (visas.length) {
        const visaStatusPill = (s) => {
            s = String(s || '');
            if (/used/i.test(s))      return `<span class="indicator-pill blue"><span>${__('Used — travelled', null, 'Employee')}</span></span>`;
            if (/cancel/i.test(s))    return `<span class="indicator-pill gray"><span>${__('Cancelled', null, 'Employee')}</span></span>`;
            return `<span class="indicator-pill green"><span>${esc(s) || __('Valid', null, 'Employee')}</span></span>`;
        };
        html += subHead(__('Visas', null, 'Employee'), `${frappe.router.make_url(["employee-visa"])}?employee=${encodeURIComponent(frm.doc.name)}`);
        html += `<div class="form-grid" style="overflow-x:auto;"><table class="table table-borderless" style="margin:0;font-size:var(--text-md);">`;
        html += `<thead><tr class="text-muted">
                    <th>${__('Visa Number', null, 'Employee')}</th><th>${__('Type', null, 'Employee')}</th><th>${__('Status', null, 'Employee')}</th>
                    <th>${__('Issued', null, 'Employee')}</th><th>${__('Travel Before', null, 'Employee')}</th><th>${__('Return Before', null, 'Employee')}</th><th>${__('Duration', null, 'Employee')}</th>
                 </tr></thead><tbody>`;
        visas.slice(0, 6).forEach(v => {
            html += `<tr>
                <td><a href="${frappe.utils.get_form_link("Employee Visa", v.name)}">${esc(v.visa_number)}</a></td>
                <td>${esc(v.visa_type) || '—'}</td>
                <td>${visaStatusPill(v.visa_status)}</td>
                <td>${du(v.visa_issue_date)}</td>
                <td>${du(v.travel_before)}</td>
                <td>${du(v.return_before)}</td>
                <td>${v.visa_duration ? esc(v.visa_duration) + ' ' + __('days', null, 'Employee') : '—'}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
        if (visas.length > 6) {
            html += `<div class="text-muted" style="font-size:var(--text-sm);margin:4px 0 0;">${__('Showing the latest 6 of {0} — click the section title to view all', [visas.length], 'Employee')}</div>`;
        }
    }

    if (ins) {
        html += subHead(__('Medical Insurance', null, 'Employee'), `${frappe.router.make_url(["employee-insurance"])}?employee=${encodeURIComponent(frm.doc.name)}`);
        html += `<div class="form-grid" style="overflow-x:auto;"><table class="table table-borderless" style="margin:0;font-size:var(--text-md);">`;
        html += `<thead><tr class="text-muted">
                    <th>${__('Policy Number', null, 'Employee')}</th><th>${__('Company', null, 'Employee')}</th><th>${__('Start', null, 'Employee')}</th><th>${__('End', null, 'Employee')}</th>
                 </tr></thead><tbody>`;
        insurances.forEach(i => {
            const expired = i.end_date && frappe.datetime.get_day_diff(i.end_date, today) < 0;
            html += `<tr>
                <td><a href="${frappe.utils.get_form_link("Employee Insurance", i.name)}">${esc(i.policy_number)}</a></td>
                <td>${esc(i.company_name) || '—'}</td>
                <td>${du(i.start_date)}</td>
                <td class="${expired ? 'text-danger' : ''}">${du(i.end_date)}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    }

    if (dependents.length) {
        html += subHead(__('Dependents', null, 'Employee'), `${frappe.router.make_url(["employee-dependent"])}?employee=${encodeURIComponent(frm.doc.name)}`);
        html += `<div class="form-grid" style="overflow-x:auto;"><table class="table table-borderless" style="margin:0;font-size:var(--text-md);">`;
        html += `<thead><tr class="text-muted">
                    <th>${__('Name', null, 'Employee')}</th><th>${__('Relation', null, 'Employee')}</th><th>${__('Iqama Expiry', null, 'Employee')}</th><th>${__('Status', null, 'Employee')}</th>
                 </tr></thead><tbody>`;
        dependents.forEach(d => {
            const days = d.iqama_expiry_date ? frappe.datetime.get_day_diff(d.iqama_expiry_date, today) : null;
            const dateClass = days !== null && days < 0 ? 'text-danger' : (days !== null && days <= 30 ? 'text-warning' : '');
            html += `<tr>
                <td><a href="${frappe.utils.get_form_link("Employee Dependent", d.name)}">${esc(d.full_name) || esc(d.name)}</a></td>
                <td>${esc(d.relationship) || '—'}</td>
                <td class="${dateClass}">${du(d.iqama_expiry_date)}</td>
                <td>${esc(d.status) || '—'}</td>
            </tr>`;
        });
        html += `</tbody></table></div>`;
    }

    if (!visas.length && !ins && !dependents.length) {
        html += `<div class="text-muted" style="padding:8px 0;">${__('No Muqeem data yet — run the advanced sync from the Muqeem script.', null, 'Employee')}</div>`;
    }

    html += `</div>`;
    return html;

    function subHead(title, href) {
        return `<div style="margin:12px 0 6px;font-weight:600;color:var(--heading-color);font-size:var(--text-md);">
                    <a href="${href}" style="color:inherit;text-decoration:none;">${title} <span class="text-muted" style="font-weight:400;">↗</span></a>
                </div>`;
    }
}


function addOpeningLeaveAllocationButton(frm) {
    frm.page.add_menu_item(__('Create Opening Leave Allocation'), function() {
        const dialog = new frappe.ui.Dialog({
            title: __('Create Opening Leave Allocation'),
            size: 'extra-large',
            fields: [{
                fieldname: 'allocations',
                fieldtype: 'Table',
                label: __('Leave Allocations'),
                reqd: 1,
                in_place_edit: true,
                data: [{
                    from_date: frm.doc.date_of_joining,
                    to_date: frappe.datetime.add_months(frm.doc.date_of_joining, 12)
                }],
                fields: [
                    { fieldname: 'leave_type', fieldtype: 'Link', options: 'Leave Type', label: __('Leave Type'), in_list_view: 1, reqd: 1 },
                    { fieldname: 'from_date', fieldtype: 'Date', label: __('From Date'), in_list_view: 1, reqd: 1 },
                    { fieldname: 'to_date', fieldtype: 'Date', label: __('To Date'), in_list_view: 1, reqd: 1 },
                    { fieldname: 'new_leaves_allocated', fieldtype: 'Float', label: __('New Leaves Allocated'), in_list_view: 1, reqd: 1 },
                    { fieldname: 'carry_forward', fieldtype: 'Check', label: __('Carry Forward'), in_list_view: 1, default: 0 }
                ]
            }],
            primary_action_label: __('Create'),
            primary_action(values) {
                frappe.call({
                    method: 'afmco.people_and_payroll.api.opening_leave_allocation.create_opening_leave_allocations',
                    args: { employee: frm.doc.name, allocations: values.allocations },
                    freeze: true
                }).then(({ message: created }) => {
                    dialog.hide();
                    frappe.show_alert({ message: __('Leave Allocations created: {0}', [created.join(', ')]), indicator: 'green' });
                    frm.reload_doc();
                });
            }
        });
        dialog.show();
    });
}


function addEmployeeDuesButton(frm) {
    frm.page.add_menu_item(__('View Employee Dues', null, 'Employee'), async function() {
        const { message: dues } = await frappe.call({
            method: 'afmco.people_and_payroll.api.employee_dues.get_employee_dues',
            args: { employee: frm.doc.name }
        });
        showEmployeeDuesDialog(frm.doc, Math.round(dues.advance_balance), Math.round(dues.monthly_salary));
    });
}

function showEmployeeDuesDialog(employee, balance, netPay) {
    const escape = frappe.utils.escape_html;
    const rows = [
        [__('Employee Number', null, 'Employee'), employee.employee_number],
        [__('Employee Name', null, 'Employee'), employee.employee_name],
        [__('Nationality', null, 'Employee'), employee.nationality],
        [__('Designation', null, 'Employee'), employee.designation],
        [__('Monthly Salary', null, 'Employee'), __('{0} Saudi Riyals', [netPay], 'Employee')],
        [__('Iqama Status', null, 'Employee'), employee.iqama_expiration_date]
    ].map(([label, value]) => `<tr><th>${escape(label)}</th><td>${escape(value == null ? '' : String(value))}</td></tr>`);

    const debt = balance > 0
        ? `<div class="alert alert-warning"><strong>${escape(__('Important Notice', null, 'Employee'))}</strong>
           <div>${escape(__('The employee has an outstanding debt of {0} Saudi Riyals.', [balance], 'Employee'))}</div></div>`
        : '';

    const dialog = new frappe.ui.Dialog({
        title: __('Salary Certificate', null, 'Employee'),
        fields: [{ fieldname: 'certificate', fieldtype: 'HTML' }]
    });
    dialog.fields_dict.certificate.$wrapper.html(`
        <p>${escape(__('We, {0}, certify that the employee whose details are shown below works for us:', [employee.company], 'Employee'))}</p>
        <table class="table table-bordered">${rows.join('')}</table>
        <p class="text-muted">${escape(__("This certificate was issued at the employee's request without any liability on the company.", null, 'Employee'))}</p>
        ${debt}
    `);
    dialog.show();
}

function handleIqamaExpiredStatus(frm) {
    frm.set_df_property('custom_iqama_expired', 'hidden', 1);

    if (frm.doc.custom_iqama_expired && frm.doc.status === 'Active') {
        frm.set_df_property('status', 'description', 'Expired Iqama');
        frm.set_df_property('status', 'field_style', 'color: red;');
    }
}

function displayIqamaExpiredAlert(frm) {
    if (!frm.doc.custom_iqama_expired) return;

    let sidebar = $('ul.list-unstyled.sidebar-menu.text-muted');
    let alert_title = __('Iqama Expired', null, 'Employee');
    let alert_message = __('Please take the necessary steps to renew the Iqama to ensure compliance with residency and labor regulations.', null, 'Employee');

    if (!sidebar.find('.alert-expired-iqama').length) {
        const alert_element = createIqamaExpiredAlert(alert_title, alert_message);
        sidebar.append(alert_element);
    }
}

function createIqamaExpiredAlert(title, message) {
    return $(`
        <li class="alert-expired-iqama" style="margin-top: 15px;">
            <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
                        border: 1px solid #ffeeba;
                        border-radius: 8px;
                        padding: 16px;
                        box-shadow: 0 2px 6px rgba(255, 193, 7, 0.15);
                        cursor: pointer;
                        transition: all 0.3s ease;"
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(255, 193, 7, 0.25)'"
                 onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 2px 6px rgba(255, 193, 7, 0.15)'">
                <div style="display: flex;
                           align-items: start;
                           gap: 12px;">
                    <i class="fa fa-exclamation-triangle"
                       style="color: #f39c12;
                              font-size: 20px;
                              margin-top: 2px;"></i>
                    <div>
                        <strong style="font-size: 15px;
                                      color: #856404;
                                      display: block;
                                      margin-bottom: 6px;">
                            ${title}
                        </strong>
                        <p style="margin: 0;
                                 font-size: 13px;
                                 color: #6c5a0b;
                                 line-height: 1.5;">
                            ${message}
                        </p>
                    </div>
                </div>
            </div>
        </li>
    `);
}

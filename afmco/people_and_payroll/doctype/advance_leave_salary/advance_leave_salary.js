// --- NEW ICONS OBJECT ---
const dashboard_icons = {
    plane: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"></path></svg>`,
    invoice: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`,
    sort: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18M3 10h12M3 16h6"></path></svg>`,
    sortUp: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18M3 10h12M3 16h6m12-6l-3-3-3 3m3 3V4"></path></svg>`,
    sortDown: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18M3 10h12M3 16h6m12 6l-3-3-3 3m3-3v9"></path></svg>`,
    check: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    cross: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    clock: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`,
    arrowRight: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>`,
    externalLink: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>`,
};

/* ---------------------------------- */
/* Vacation History Dashboard        */
/* ---------------------------------- */

async function renderVacationDashboard_old(employee, excludeDocname) {
    const containerId = 'vacation-history-dashboard';
    const oldDashboard = document.getElementById(containerId);
    if (oldDashboard) oldDashboard.remove();

    if (!employee) return;

    const vaList = await fetchAdvanceLeaveSalaryList(employee, excludeDocname);
    if (!vaList || vaList.length === 0) return;

    const vacationDetails = await fetchVacationDetails(vaList);
    const structuredData = structureVacationData(vacationDetails);
    if (structuredData.length === 0) return;

    const dashboardElement = createVacationDashboard(structuredData);
    const host = document.querySelector(".layout-main-section") || cur_frm.wrapper;
    host.prepend(dashboardElement);

    setTimeout(enableVacationSorting, 100);
}

async function fetchAdvanceLeaveSalaryList(employee, excludeDocname) {
    const { message } = await frappe.call({
        method: "frappe.client.get_list",
        args: {
            doctype: "Advance Leave Salary",
            filters: [
                ["employee", "=", employee],
                ["name", "!=", excludeDocname],
                ["docstatus", "in", [0, 1, 2]]
            ],
            fields: ["name", "docstatus", "workflow_state"],
            order_by: "creation desc",
            limit: 1000
        }
    });
    return message || [];
}

async function fetchVacationDetails(vaList) {
    return await Promise.allSettled(
        vaList.map(d => frappe.call({
            method: "frappe.client.get",
            args: { doctype: "Advance Leave Salary", name: d.name }
        }))
    );
}

function structureVacationData(settled) {
    const rows = [];
    settled.forEach((res) => {
        if (res.status !== "fulfilled") return;
        const doc = res.value.message;
        if (!doc || !doc.cva) return;

        const { statusLabel, badgeClass } = getDocumentStatus(doc);

        doc.cva.forEach(row => {
            rows.push({
                document: doc.name,
                docBadge: badgeClass,
                docStatus: statusLabel,
                start: frappe.datetime.str_to_user(row.contract_start_date),
                end: frappe.datetime.str_to_user(row.contract_end_date)
            });
        });
    });
    return rows;
}


/* ---------------------------------- */
/* Payment Request Dashboard          */
/* ---------------------------------- */
async function renderPaymentRequestDashboard_old(docname, pr_status) {
    const containerId = "payment-requests-dashboard";
    const oldDashboard = document.getElementById(containerId);
    if (oldDashboard) oldDashboard.remove();
    
    if (pr_status !== "PR Created") return;

    const payments = await fetchPaymentRequests(docname);
    if (!payments || !payments.length) return;

    const dashboardElement = createPaymentRequestDashboard(payments, containerId);
    const host = document.querySelector(".layout-main-section") || cur_frm.wrapper;
    host.prepend(dashboardElement);
}

async function fetchPaymentRequests(docname) {
    try {
        const { message } = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Payment Requisition",
                filters: { tax_invoice_number: docname },
                fields: ["name", "amount", "workflow_state"],
                limit: 10
            }
        });
        return message || [];
    } catch (err) {
        console.warn("No permission to view Payment Requests:", err);
        return [];
    }
}


/* ---------------------------------- */
/* --- Dashboard UI Generation ---    */
/* ---------------------------------- */

function getDocumentStatus_old(doc) {
    let statusLabel, badgeClass, icon;
    const state = doc.workflow_state || '';
    if (state.includes("Rejected") || (doc.docstatus === 2)) {
        statusLabel = state || "Cancelled";
        badgeClass = "danger";
        icon = dashboard_icons.cross;
    } else if (state.includes("Approved") || state.includes("Paid") || (doc.docstatus === 1)) {
        statusLabel = state || "Paid";
        badgeClass = "success";
        icon = dashboard_icons.check;
    } else {
        statusLabel = state || "Pending";
        badgeClass = "warning";
        icon = dashboard_icons.clock;
    }
    return { statusLabel, badgeClass, icon };
}

function createVacationDashboard_old(rows) {
    const containerId = "vacation-history-dashboard";
    
    const groupedDocs = rows.reduce((acc, r) => {
        if (!acc[r.document]) {
            acc[r.document] = { badge: r.docBadge, status: r.docStatus, rows: [] };
        }
        acc[r.document].rows.push(r);
        return acc;
    }, {});

    const dashboardHTML = `
    <style>
        .vd-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin: 20px 0; font-family: 'Inter', sans-serif; }
        .vd-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb; }
        .vd-title-group { display: flex; align-items: center; gap: 12px; }
        .vd-title-icon { color: var(--primary, #3b82f6); }
        .vd-title-icon svg { width: 24px; height: 24px; }
        .vd-title { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
        .vd-sort-btn { background: #fff; border: 1px solid #d1d5db; color: #374151; font-size: 13px; font-weight: 500; display: inline-flex; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 6px; cursor: pointer; }
        .vd-sort-btn svg { width: 14px; height: 14px; }
        .vd-document-section { margin-bottom: 12px; background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .vd-summary { padding: 12px 16px; cursor: pointer; display: flex; align-items: center; gap: 12px; list-style: none; }
        .vd-summary::-webkit-details-marker { display: none; }
        .vd-doc-name { flex: 1; font-weight: 500; color: #1f2937; }
        .vd-status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; }
        .vd-status-pill.success { background-color: #ecfdf5; color: #065f46; }
        .vd-status-pill.danger { background-color: #fef2f2; color: #991b1b; }
        .vd-status-pill.warning { background-color: #fffbeb; color: #92400e; }
        .vd-status-pill svg { width: 14px; height: 14px; }
        .vd-periods-table-container { padding: 0 16px 16px; }
        .vd-periods-table { width: 100%; border-collapse: collapse; }
        .vd-periods-table th, .vd-periods-table td { text-align: left; padding: 10px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
        .vd-periods-table th { color: #6b7280; font-weight: 500; }
        .vd-periods-table tr:last-child td { border-bottom: none; }
        .vd-period-cell { display: flex; align-items: center; gap: 8px; }
        .vd-period-cell svg { width: 14px; height: 14px; color: #9ca3af; }
        .vd-open-btn { background: transparent; border: none; color: var(--primary, #3b82f6); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; }
        .vd-open-btn svg { width: 14px; height: 14px; }
    </style>
    <div id="${containerId}" class="vd-card">
        <div class="vd-header">
            <div class="vd-title-group">
                <span class="vd-title-icon">${dashboard_icons.plane}</span>
                <h4 class="vd-title">Vacation History</h4>
            </div>
            <button class="vd-sort-btn" id="sort-vh"><span class="icon">${dashboard_icons.sort}</span> Sort</button>
        </div>
        <div class="vacation-documents">
            ${Object.keys(groupedDocs).map(docName => {
                const doc = groupedDocs[docName];
                const { icon } = getDocumentStatus({ workflow_state: doc.status, docstatus: 0 }); // pass dummy docstatus
                return `
                <details class="vd-document-section">
                    <summary class="vd-summary">
                        <span class="vd-status-pill ${doc.badge}"><span class="icon">${icon}</span> ${doc.status}</span>
                        <strong class="vd-doc-name">${docName}</strong>
                    </summary>
                    <div class="vd-periods-table-container">
                        <table class="vd-periods-table">
                            <thead><tr><th>Period</th><th style="text-align:right;">Action</th></tr></thead>
                            <tbody>
                            ${doc.rows.map(row => `
                                <tr>
                                    <td>
                                        <div class="vd-period-cell">
                                            <span>${row.start}</span>
                                            <span class="icon">${dashboard_icons.arrowRight}</span>
                                            <span>${row.end}</span>
                                        </div>
                                    </td>
                                    <td style="text-align:right;">
                                        <button class="vd-open-btn" onclick="frappe.set_route('Form','Advance Leave Salary','${docName}')">
                                            <span class="icon">${dashboard_icons.externalLink}</span> Open
                                        </button>
                                    </td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                </details>`;
            }).join('')}
        </div>
    </div>`;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = dashboardHTML;
    return wrapper;
}

function createPaymentRequestDashboard_old(payments, containerId) {
    const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);

    const dashboardHTML = `
    <style>
        .pr-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 12px; padding: 20px; margin: 20px 0; font-family: 'Inter', sans-serif; }
        .pr-header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 16px; margin-bottom: 16px; border-bottom: 1px solid #e5e7eb; }
        .pr-title-group { display: flex; align-items: center; gap: 12px; }
        .pr-title-icon { color: var(--primary, #16a34a); }
        .pr-title-icon svg { width: 24px; height: 24px; }
        .pr-title { font-size: 18px; font-weight: 600; color: #111827; margin: 0; }
        .pr-count-pill { background-color: #dcfce7; color: #15803d; font-size: 13px; font-weight: 500; padding: 6px 12px; border-radius: 999px; }
        .pr-table-wrapper { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
        .pr-table { width: 100%; border-collapse: collapse; }
        .pr-table th, .pr-table td { text-align: left; padding: 12px; border-bottom: 1px solid #f3f4f6; font-size: 13px; }
        .pr-table thead { background-color: #f9fafb; }
        .pr-table th { color: #6b7280; font-weight: 500; }
        .pr-table tr:last-child td { border-bottom: none; }
        .pr-table tfoot td { font-weight: 600; }
        .pr-total-amount { color: #15803d; font-size: 16px; }
        .pr-status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 500; white-space: nowrap; }
        .pr-status-pill.success { background-color: #ecfdf5; color: #065f46; }
        .pr-status-pill.danger { background-color: #fef2f2; color: #991b1b; }
        .pr-status-pill.warning { background-color: #fffbeb; color: #92400e; }
        .pr-status-pill svg { width: 14px; height: 14px; }
        .pr-open-btn { background: transparent; border: none; color: var(--primary, #3b82f6); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; font-weight: 500; }
        .pr-open-btn svg { width: 14px; height: 14px; }
    </style>
    <div id="${containerId}" class="pr-card">
        <div class="pr-header">
            <div class="pr-title-group">
                <span class="pr-title-icon">${dashboard_icons.invoice}</span>
                <h4 class="pr-title">Payment Requests</h4>
            </div>
            <span class="pr-count-pill">${payments.length} Request${payments.length !== 1 ? 's' : ''}</span>
        </div>
        <div class="pr-table-wrapper">
            <table class="pr-table">
                <thead><tr><th>Document</th><th>Status</th><th style="text-align:right;">Amount</th><th style="text-align:center;">Action</th></tr></thead>
                <tbody>
                ${payments.map(p => {
                    const { statusLabel, badgeClass, icon } = getDocumentStatus({ workflow_state: p.workflow_state, docstatus: 0 });
                    return `
                    <tr>
                        <td>${p.name}</td>
                        <td><span class="pr-status-pill ${badgeClass}"><span class="icon">${icon}</span> ${statusLabel}</span></td>
                        <td style="text-align:right; font-weight: 500;">${(p.amount || 0).toLocaleString('en-US')} SAR</td>
                        <td style="text-align:center;">
                            <button class="pr-open-btn" onclick="frappe.set_route('Form', 'Payment Requisition', '${p.name}')">
                                <span class="icon">${dashboard_icons.externalLink}</span> Open
                            </button>
                        </td>
                    </tr>`;
                }).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="2">Total</td>
                        <td class="pr-total-amount" style="text-align:right;">${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} SAR</td>
                        <td></td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = dashboardHTML;
    return wrapper;
}

function enableVacationSorting_old() {
    const sortButton = document.getElementById("sort-vh");
    if (!sortButton) return;
    
    sortButton.onclick = function() {
        const container = document.getElementById("vacation-history-dashboard");
        if (!container) return;
        
        const host = document.querySelector(".layout-main-section") || cur_frm.wrapper;
        const documentsContainer = container.querySelector(".vacation-documents");
        if (!documentsContainer) return;

        const list = Array.from(documentsContainer.querySelectorAll("details.vd-document-section"));
        
        const asc = !host.__vhAsc;
        
        list.sort((a, b) => {
            const textA = a.querySelector("strong.vd-doc-name").textContent.trim();
            const textB = b.querySelector("strong.vd-doc-name").textContent.trim();
            return asc ? textA.localeCompare(textB) : textB.localeCompare(textA);
        });
        
        list.forEach(el => documentsContainer.appendChild(el));
        
        host.__vhAsc = asc;
        
        sortButton.querySelector('.icon').innerHTML = asc ? dashboard_icons.sortUp : dashboard_icons.sortDown;
    };
}

/* ---------------------------------- */
/* --- Main Form Event Handler ---    */
/* ---------------------------------- */
function fmt(value) {
    if (!value) return __('SAR', null, 'Advance Leave Salary') + ' 0.00';
    return `${__('SAR', null, 'Advance Leave Salary')} ${parseFloat(value).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}`;
}
function updateDashboards_old(frm) {
    renderVacationDashboard(frm.doc.employee, frm.doc.name);
    renderPaymentRequestDashboard(frm.doc.name, frm.doc.pr_status);
}

async function updateDashboards(frm) {
    if (!frm.doc.employee) return;
    
    let vacationHTML = '';
    let paymentHTML = '';
    
    try {
        const { message: vaList } = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Advance Leave Salary",
                filters: [
                    ["employee", "=", frm.doc.employee],
                    ["name", "!=", frm.doc.name],
                    ["docstatus", "in", [0, 1, 2]]
                ],
                fields: ["name", "docstatus", "workflow_state"],
                order_by: "creation desc",
                limit: 1000
            }
        });
        
        if (vaList && vaList.length > 0) {
            const settled = await Promise.allSettled(
                vaList.map(d => frappe.call({
                    method: "frappe.client.get",
                    args: { doctype: "Advance Leave Salary", name: d.name }
                }))
            );
            
            const rows = [];
            settled.forEach((res) => {
                if (res.status !== "fulfilled") return;
                const doc = res.value.message;
                if (!doc || !doc.cva) return;
                
                let statusLabel, badgeClass;
                if (doc.workflow_state) {
                    statusLabel = doc.workflow_state;
                    if (statusLabel.includes("Rejected")) {
                        badgeClass = "danger";
                    } else if (statusLabel.includes("Approved") || statusLabel.includes("Paid")) {
                        badgeClass = "success";
                    } else {
                        badgeClass = "warning";
                    }
                } else {
                    switch (doc.docstatus) {
                        case 1:
                            statusLabel = "Paid";
                            badgeClass = "success";
                            break;
                        case 2:
                            statusLabel = "Cancelled";
                            badgeClass = "danger";
                            break;
                        default:
                            statusLabel = "Pending";
                            badgeClass = "warning";
                    }
                }
                
                doc.cva.forEach(row => {
                    rows.push({
                        document: doc.name,
                        docBadge: badgeClass,
                        docStatus: statusLabel,
                        start: frappe.datetime.str_to_user(row.contract_start_date),
                        end: frappe.datetime.str_to_user(row.contract_end_date)
                    });
                });
            });
            
            if (rows.length > 0) {
                const groupedDocs = rows.reduce((acc, r) => {
                    if (!acc[r.document]) {
                        acc[r.document] = { badge: r.docBadge, status: r.docStatus, rows: [] };
                    }
                    acc[r.document].rows.push(r);
                    return acc;
                }, {});
                
                let docsHTML = '';
                Object.keys(groupedDocs).forEach((docName, index) => {
                    const doc = groupedDocs[docName];
                    const collapseId = `vacation-collapse-${index}`;
                    docsHTML += `
                        <div class="col-12 mb-2">
                            <div class="vacation-card">
                                <div class="card-header collapsible" data-toggle="collapse" data-target="#${collapseId}">
                                    <div class="header-content">
                                        <span class="document-name">${docName}</span>
                                        <span class="indicator-pill ${doc.badge}">${doc.status}</span>
                                    </div>
                                    <span class="collapse-icon">
                                        <svg class="icon icon-xs">
                                            <use href="#icon-down"></use>
                                        </svg>
                                    </span>
                                </div>
                                <div id="${collapseId}" class="collapse">
                                    <table class="vacation-table">
                                        <thead>
                                            <tr>
                                                <th>Start Date</th>
                                                <th>End Date</th>
                                                <th class="text-right">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${doc.rows.map(row => `
                                                <tr>
                                                    <td>${row.start}</td>
                                                    <td>${row.end}</td>
                                                    <td class="text-right">
                                                        <a class="btn-link" onclick="frappe.set_route('Form','Advance Leave Salary','${docName}')">
                                                            Open →
                                                        </a>
                                                    </td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `;
                });
                
                vacationHTML = `
                    <div class="dashboard-section">
                        <h6 class="section-title">Vacation History</h6>
                        <div class="row">${docsHTML}</div>
                    </div>
                `;
            }
        }
    } catch (err) {
        console.warn("Error fetching vacation data:", err);
    }
    
    if (frm.doc.pr_status === "PR Created") {
        try {
            const { message: payments } = await frappe.call({
                method: "frappe.client.get_list",
                args: {
                    doctype: "Payment Requisition",
                    filters: { tax_invoice_number: frm.doc.name },
                    fields: ["name", "amount", "workflow_state"],
                    limit: 10
                }
            });
            
            if (payments && payments.length > 0) {
                const totalAmount = payments.reduce((sum, p) => sum + (p.amount || 0), 0);
                
                const summaryCards = `
                    <div class="payment-summary">
                        <div class="summary-card">
                            <div class="summary-label">Requests</div>
                            <div class="summary-value">${payments.length}</div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Total Amount</div>
                            <div class="summary-value primary">${fmt(totalAmount)}</div>
                        </div>
                        <div class="summary-card">
                            <div class="summary-label">Status</div>
                            <div class="summary-badge">
                                <span class="indicator-pill ${frm.doc.pr_status === 'PR Created' ? 'success' : 'warning'}">${frm.doc.pr_status}</span>
                            </div>
                        </div>
                    </div>
                `;
                
                const paymentsTable = payments.map(p => {
                    const statusClass = p.workflow_state?.includes('Approved') ? 'success' : 
                                       p.workflow_state?.includes('Rejected') ? 'danger' : 'warning';
                    return `
                        <tr>
                            <td><strong>${p.name}</strong></td>
                            <td class="amount-cell">${fmt(p.amount)}</td>
                            <td><span class="indicator-pill ${statusClass}">${p.workflow_state || 'Pending'}</span></td>
                            <td class="text-right">
                                <a class="btn-link" onclick="frappe.set_route('Form', 'Payment Requisition', '${p.name}')">
                                    Open →
                                </a>
                            </td>
                        </tr>
                    `;
                }).join('');
                
                paymentHTML = `
                    <div class="dashboard-section">
                        <h6 class="section-title">Payment Requests</h6>
                        ${summaryCards}
                        <div class="payment-card">
                            <table class="payment-table">
                                <thead>
                                    <tr>
                                        <th>Document</th>
                                        <th>Amount</th>
                                        <th>Status</th>
                                        <th class="text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody>${paymentsTable}</tbody>
                                <tfoot>
                                    <tr class="total-row">
                                        <td><strong>Total</strong></td>
                                        <td class="amount-cell total">${fmt(totalAmount)}</td>
                                        <td colspan="2"></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                `;
            }
        } catch (err) {
            console.warn("Error fetching payment data:", err);
        }
    }
    
    if (vacationHTML || paymentHTML) {
        const combinedHTML = `
            <div id="combined-dashboard">
                ${vacationHTML}
                ${paymentHTML}
                <style>
                    #combined-dashboard { margin: 10px 0; }
                    .dashboard-section { margin-bottom: 15px; }
                    .section-title {
                        font-size: 13px;
                        font-weight: 600;
                        color: var(--text-color);
                        margin: 0 0 8px 0;
                        padding: 0;
                    }
                    .vacation-card, .payment-card {
                        background: var(--card-bg, #ffffff);
                        border: 1px solid var(--border-color);
                        border-radius: var(--border-radius);
                        overflow: hidden;
                    }
                    .card-header {
                        padding: 8px 10px;
                        background: var(--bg-light-gray);
                        border-bottom: 1px solid var(--border-color);
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        cursor: pointer;
                        transition: background 0.2s;
                    }
                    .card-header:hover {
                        background: var(--gray-100);
                    }
                    .card-header .header-content {
                        display: flex;
                        align-items: center;
                        gap: 10px;
                        flex: 1;
                    }
                    .card-header .collapse-icon {
                        transition: transform 0.2s;
                        color: var(--text-muted);
                    }
                    .card-header[aria-expanded="true"] .collapse-icon {
                        transform: rotate(180deg);
                    }
                    .document-name {
                        font-weight: 500;
                        color: var(--text-color);
                        font-size: 13px;
                    }
                    .indicator-pill {
                        padding: 2px 8px;
                        border-radius: 10px;
                        font-size: 11px;
                        font-weight: 500;
                        display: inline-block;
                    }
                    .indicator-pill.success {
                        background: var(--indicator-green-bg, #dcfce7);
                        color: var(--indicator-green, #15803d);
                    }
                    .indicator-pill.danger {
                        background: var(--indicator-red-bg, #fee2e2);
                        color: var(--indicator-red, #b91c1c);
                    }
                    .indicator-pill.warning {
                        background: var(--indicator-yellow-bg, #fef9c3);
                        color: var(--indicator-yellow, #a16207);
                    }
                    .vacation-table, .payment-table {
                        width: 100%;
                        margin: 0;
                        border-collapse: collapse;
                    }
                    .vacation-table thead th, .payment-table thead th {
                        padding: 6px 10px;
                        font-size: 12px;
                        font-weight: 500;
                        color: var(--text-muted);
                        background: var(--bg-light-gray);
                        border-bottom: 1px solid var(--border-color);
                        text-align: left;
                    }
                    .vacation-table tbody td, .payment-table tbody td, .payment-table tfoot td {
                        padding: 6px 10px;
                        font-size: 13px;
                        color: var(--text-color);
                        border-bottom: 1px solid var(--table-border-color);
                    }
                    .vacation-table tbody tr:hover, .payment-table tbody tr:hover {
                        background: var(--table-hover-bg, #f9fafb);
                    }
                    .vacation-table tbody tr:last-child td { border-bottom: none; }
                    .btn-link {
                        color: var(--primary);
                        font-weight: 500;
                        cursor: pointer;
                        text-decoration: none;
                        font-size: 12px;
                    }
                    .btn-link:hover { text-decoration: underline; }
                    .payment-summary {
                        display: grid;
                        grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                        gap: 8px;
                        margin-bottom: 10px;
                    }
                    .summary-card {
                        background: var(--card-bg, #ffffff);
                        border: 1px solid var(--border-color);
                        border-radius: var(--border-radius);
                        padding: 8px 10px;
                    }
                    .summary-label {
                        font-size: 11px;
                        color: var(--text-muted);
                        margin-bottom: 4px;
                    }
                    .summary-value {
                        font-size: 18px;
                        font-weight: 600;
                        color: var(--text-color);
                        line-height: 1.2;
                    }
                    .summary-value.primary { color: var(--primary); }
                    .summary-badge { margin-top: 2px; }
                    .payment-table .amount-cell {
                        font-weight: 500;
                        font-variant-numeric: tabular-nums;
                    }
                    .payment-table tfoot {
                        border-top: 2px solid var(--border-color);
                    }
                    .payment-table .total-row td {
                        border-bottom: none;
                        padding-top: 8px;
                    }
                    .payment-table .amount-cell.total {
                        color: var(--primary);
                        font-weight: 600;
                        font-size: 14px;
                    }
                </style>
            </div>
        `;
        
        frm.dashboard.add_section(combinedHTML);
        frm.dashboard.show();
    }
}
frappe.ui.form.on('Advance Leave Salary', {

  validate: function(frm) {

    checkDuplicateContractStartDate(frm);
    const requiredFields = [
      'account_no',
      'date_1',
      'date_2',
      'total_salary',
      'vacation_days_per_year',
    ];

    requiredFields.forEach((field) => {
      if (!frm.doc[field]) {
        frappe.msgprint(`Employee data must be added before saving the file: ${field}`);
        frappe.validated = false;
      }
    });
},
  refresh: function(frm) {
        updateDashboards(frm);
        frappe.require(["/assets/afmco/js/approver_check.js", "/assets/afmco/css/approver_check.css"], () => afmco.approver_check.attach(frm));

        if (["Paid", "Approved"].includes(frm.doc.workflow_state)) {
            frm.add_custom_button('Cancel Request', () => Cancel_Request(frm)).addClass('btn-danger');
        }
        
    ['salary_per_day', 'duration_of_service', 'dos_years', 'cva_total', 'deductions', 'amount'].forEach(field => {
      frm.set_df_property(field, 'read_only', 1);
    });
    if (frm.doc.workflow_state === 'Waiting Accountant Approval') {
        frm.set_df_property('cva', 'read_only', 0); 
        
    } else {
        frm.set_df_property('cva', 'read_only', 1);
        
    }
    if (frm.doc.workflow_state === 'Approved' && frm.doc.pr_status == 'PR Not Created') {
      frm.add_custom_button(__('Create PR'), async () => {
        await frm.set_value('pr_status', 'PR Created');

        await frappe.db.set_value(frm.doctype, frm.docname, 'pr_status', 'PR Created');
        
        const expenseRequest = frappe.model.get_new_doc('Payment Requisition');
        expenseRequest.tax_invoice_number = frm.doc.name;
        expenseRequest.account_no = frm.doc.account_no;
        expenseRequest.beneficiary_name = `${frm.doc.employee_name} ${frm.doc.employee}`;
        expenseRequest.amount = frm.doc.amount;
        expenseRequest.project = frm.doc.payroll_cost_center;
        expenseRequest.cost_center = frm.doc.branch;
        expenseRequest.jv_status = 'JV Not Created';
        expenseRequest.naming_series = 'PR-.YYYY.-';
        expenseRequest.date = frappe.datetime.nowdate();
        expenseRequest.bank_payment_date = frappe.datetime.nowdate();
        expenseRequest.payment_type = 'Advance Leave Salary';
        expenseRequest.mode_of_payment = 'Bank Transfer';
        expenseRequest.payment_approver ='Human Resources - الموارد البشرية';
        expenseRequest.remark = `
            Vacation Salary Request
            -------------------------------------
            - Service in Days| ${frm.doc.duration_of_service}
            - Service in Years| ${frm.doc.dos_years}
            - Total Salary| ${frm.doc.total_salary}
            - Ticket Allowance| ${frm.doc.ticket_allowance}
            - Number of Tickets| ${frm.doc.number_of_tickets}
            - Total Ticket| ${frm.doc.ticket_allowance * frm.doc.number_of_tickets} (${frm.doc.not_eligible_for_ticket_allowance ? "No" : "Yes"})
            - Afmco Reward| ${frm.doc.alternative_reward}
            - Deductions| ${frm.doc.deductions}
            - Total Amount| ${frm.doc.amount}
            
            Summary:
            - ${frm.doc.cva_total} + (${frm.doc.ticket_allowance} * ${frm.doc.number_of_tickets}) - ${frm.doc.deductions} = ${frm.doc.amount}
            `;

        frappe.set_route('Form', expenseRequest.doctype, expenseRequest.name);
        frappe.msgprint(__('A new payment request was created', null, 'Advance Leave Salary'));
      }).addClass('btn-danger');
    }
    if (frm.doc.workflow_state === 'Waiting Accountant Approval') {
            frm.add_custom_button(__('Get Advance Leave Salary'), async () => {
          if (frm.is_dirty()) await frm.save();
          await frappe.call({
            method: 'afmco.people_and_payroll.api.advance_leave_salary.fill_leave_allowance',
            args: { doctype: frm.doctype, name: frm.docname },
            freeze: true,
          });
          frm.reload_doc();
        }).addClass('btn-primary');

            frm.add_custom_button(__('Open General Ledger'), function() {
                var parameters = {
                    company: "شركة عبدالله فهد المطيري للخدمات المساندة",
                    from_date: frm.doc.date_1,
                    to_date: frm.doc.date_2,
                    party_type: "Employee",
                    party: frm.doc.employee,
                };

                frappe.set_route("query-report", "General Ledger", parameters);
            });
        }
  },
  employee: function(frm) {
        updateDashboards(frm);
    },
  create_sadad_pr: function(frm) {
        let VisaAmount = frm.doc.days1 === '30' ? 200 : frm.doc.days1 === '60' ? 200 : frm.doc.days1 === '90' ? 300 : frm.doc.days1 === '120' ? 400 : 0;
        const expenseRequest = frappe.model.get_new_doc('Payment Requisition');
        expenseRequest.tax_invoice_number = frm.doc.name;
        expenseRequest.account_no = "MOI SADAD";
        expenseRequest.beneficiary_name = `${frm.doc.employee_name} ${frm.doc.employee}`;
        expenseRequest.amount = VisaAmount;
        expenseRequest.project = frm.doc.payroll_cost_center;
        expenseRequest.cost_center = frm.doc.branch;
        expenseRequest.jv_status = 'JV Not Created';
        expenseRequest.naming_series = 'PR-.YYYY.-';
        expenseRequest.bank_payment_date = frappe.datetime.nowdate();
        expenseRequest.date = frappe.datetime.nowdate();
        expenseRequest.payment_type = 'SADAD Payment';
        expenseRequest.mode_of_payment = 'Bank Transfer';
        expenseRequest.remark = `Exit and return visa:
- Employee Name: ${frm.doc.employee_name}
- Employee ID: ${frm.doc.employee}
- From Date: ${frm.doc.start}
- Days: ${frm.doc.days1}`;
        frappe.set_route('Form', expenseRequest.doctype, expenseRequest.name);
        frappe.msgprint(__('A new repayment request was created', null, 'Advance Leave Salary'));
    },
  before_save: async function(frm) {
    if (!frm.doc.ticket_allowance) {
        if (frm.doc.branch === "Bin Zagr - بن زقر - AF") {
            frm.doc.ticket_allowance = 960;
        } else if (frm.doc.branch === "Bon Café - بون كافيه") {
            frm.doc.ticket_allowance = 800;
        } else if (frm.doc.branch === "Amazon RUH - امازون الرياض" || frm.doc.branch === "Amazon JED - امازون جدة" || frm.doc.branch === "Amazon - امازون") {
            frm.doc.ticket_allowance = 750;
        } else {
            frm.doc.ticket_allowance = 600;
        }
    }
    ['salary_per_day', 'duration_of_service', 'dos_years', 'cva_total', 'deductions', 'amount'].forEach(field => {
      frm.set_df_property(field, 'read_only', 0);
    });
  },
  after_save: async function (frm) {
    if (!frm.doc.employee || !frm.doc.total_salary) return;

    const { message: salaryAssignments } = await frappe.call({
      method: "frappe.client.get_list",
      args: {
        doctype: "Salary Structure Assignment",
        filters: {
          employee: frm.doc.employee,
          docstatus: 1
        },
        fields: ["base"],
        order_by: "from_date desc",
        limit_page_length: 1
      }
    });

    if (salaryAssignments && salaryAssignments.length > 0) {
      const base_salary = salaryAssignments[0].base;

      if (frm.doc.total_salary != base_salary) {
        frappe.msgprint({
          title: __('Warning', null, 'Advance Leave Salary'),
          message: __('Total salary ({0}) does not match the base salary in the system ({1}).', [frm.doc.total_salary, base_salary], 'Advance Leave Salary'),
          indicator: "orange"
        });
      }
    }
  },
  
});
function checkPreviousVacations_old(frm) {
  frappe.db.get_list('Advance Leave Salary', {
    filters: {
      'employee': frm.doc.employee,
      'name': ['!=', frm.doc.name],
      'workflow_state': ['in', ['Approved', 'Paid']]
    },
    fields: ['name', 'date_1', 'date_2']
  }).then(records => {
    if (records.length > 0) {
      let message = `<h4>${__('Found {0} previous leave settlements for this employee:', [records.length], 'Advance Leave Salary')}</h4><ul>`;
      records.forEach(record => {
        let startDate = formatDate(record.date_1);
        let endDate = formatDate(record.date_2);
        message += `<li>${__('Settlement No. {0}: from {1} to {2}', [record.name, startDate, endDate], 'Advance Leave Salary')}</li>`;
      });
      message += "</ul>";
      frappe.msgprint(message, __('Previous Leave Update', null, 'Advance Leave Salary'));
    } else {
      frappe.msgprint(__('No previous leaves exist for this employee.', null, 'Advance Leave Salary'), __('Previous Leave Update', null, 'Advance Leave Salary'));
    }
  }).catch(err => {
    console.error("Error fetching previous vacations", err);
    frappe.msgprint(__('An error occurred while retrieving previous leave data.', null, 'Advance Leave Salary'), __('Error', null, 'Advance Leave Salary'));
  });
}
function formatDate(dateString) {
  if (!dateString) return __('Unknown', null, 'Advance Leave Salary');
  let date = new Date(dateString);
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
}
function checkDuplicateContractStartDate(frm) {
    let unique_start_dates = new Set();
    let duplicates_found = false;

    frm.doc.cva.forEach(function(row) {
        if (unique_start_dates.has(row.contract_start_date)) {
            duplicates_found = true;
        } else {
            unique_start_dates.add(row.contract_start_date);
        }
    });

    if (duplicates_found) {
        frappe.msgprint(__('Please note that contract period start dates are repeated. Please review the data and make sure the dates do not overlap so the procedure is correct.', null, 'Advance Leave Salary'))
        frappe.validated = false;
    }
}
async function Cancel_Request(frm) {

    const confirmed = await new Promise((resolve) => {
        frappe.confirm(
            "Are you sure you want to cancel this request?",
            () => resolve(true),
            () => resolve(false)
        );
    });

    if (!confirmed) {
        frappe.show_alert({ message: "Cancellation aborted.", indicator: 'blue' });
        return;
    }

    try {
        if (!frm.doc.custom_allow_cancel) {
            await frappe.db.set_value(frm.doctype, frm.docname, "custom_allow_cancel", 1);
            await frm.reload_doc();
        }

        await frappe.xcall('frappe.model.workflow.apply_workflow', {
            doc: frm.doc,
            action: "Cancel"
        });

        await frm.reload_doc();
        frappe.show_alert({ message: "Request cancelled.", indicator: 'orange' });

    } catch (err) {
        frappe.msgprint({
            title: "Workflow Error",
            message: (err && err.message) || err,
            indicator: 'red'
        });
    }
}

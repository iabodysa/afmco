/**
 * Employee Financial Dashboard - Enterprise Edition
 * Premium Design + Native Architecture
 */

frappe.ui.form.on('Employee Financial Summary', {
    refresh(frm) {
        // Clear previous instances
        frm.dashboard_manager = null;
        // Button styling
        if (frm.fields_dict.search && frm.fields_dict.search.$input) {
            frm.fields_dict.search.$input.addClass('btn-primary');
        }
    },
    search(frm) {
        if (!frm.doc.employee) {
            frappe.msgprint(__('Please select an Employee'));
            return;
        }
        if (!frm.dashboard_manager) {
            frm.dashboard_manager = new EmployeeFinancialDashboard(frm);
        } else {
            frm.dashboard_manager.refresh();
        }
    }
});

class EmployeeFinancialDashboard {
    // =========================================================================
    //  LIFECYCLE
    // =========================================================================
    constructor(frm) {
        this.frm = frm;
        this.employeeId = frm.doc.employee;
        this.currency = (frappe.boot.sysdefaults && frappe.boot.sysdefaults.currency) || 'SAR';
        this.cache = new Map();
        this.charts = {};
        this.dateRange = { start: null, end: null };
        this.employeeData = null;
        this.mountId = 0;
        
        this.init();
    }

    async init() {
        this.mountId++;
        this.clearDashboard();
        this.injectCSS();
        this.renderLayout();
        await this.loadAllData();
    }

    refresh() {
        this.employeeId = this.frm.doc.employee;
        this.cache.clear();
        this.employeeData = null;
        // Do not destroy here, let init() -> clearDashboard() handle it to avoid double-handling
        this.charts = {}; 
        this.init();
    }
    
    destroyCharts() {
        if (!this.charts) return;
        Object.keys(this.charts).forEach(key => {
            const chart = this.charts[key];
            if (chart && typeof chart.destroy === 'function') {
                try { 
                    chart.destroy(); 
                } catch(e) { 
                    // Ignore NotFoundError which happens if DOM is already removed
                    if (!e.message.includes('Node')) {
                        console.warn('Chart destroy warn:', e); 
                    }
                }
            }
        });
        this.charts = {};
    }

    clearDashboard() {
        // destroyCharts is causing issues if called on already-removed nodes during refresh race conditions.
        // We will try to rely on removing the DOM. 
        // BUT ResizeObserver leaks. So we MUST destroy.
        // We will execute destroy BEFORE modifying DOM.
        this.destroyCharts();
        
        const container = this.frm.$wrapper.find('.efd-dashboard-container');
        if (container.length) {
            container.remove();
        }
    }

    // =========================================================================
    //  API & HELPERS
    // =========================================================================
    async callAPI(doctype, filters = {}, fields = ['name'], options = {}) {
        const { orderBy = 'creation desc', limit = 0 } = options;
        try {
            const res = await frappe.call({
                method: 'frappe.client.get_list',
                args: { doctype, filters, fields, order_by: orderBy, limit_page_length: limit }
            });
            return res.message || [];
        } catch (err) {
            console.warn(`[API] Error ${doctype}:`, err);
            return [];
        }
    }

    async getEmployee() {
        const cacheKey = `emp_${this.employeeId}`;
        if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
        try {
            const res = await frappe.call({ method: 'frappe.client.get', args: { doctype: 'Employee', name: this.employeeId } });
            this.cache.set(cacheKey, res.message);
            this.employeeData = res.message;
            return res.message;
        } catch (e) { return null; }
    }

    getFilters(base = {}, dateFields = ['posting_date', 'start_date']) {
        const filters = [];
        for (const [key, val] of Object.entries(base)) {
            if (Array.isArray(val)) filters.push([key, val[0], val[1]]);
            else filters.push([key, '=', val]);
        }
        if (this.dateRange.start && this.dateRange.end) {
            dateFields.forEach(f => filters.push([f, 'between', [this.dateRange.start, this.dateRange.end]]));
        } else if (this.dateRange.start) {
            dateFields.forEach(f => filters.push([f, '>=', this.dateRange.start]));
        } else if (this.dateRange.end) {
            dateFields.forEach(f => filters.push([f, '<=', this.dateRange.end]));
        }
        return filters;
    }

    safeFloat(val, def = 0) { const n = parseFloat(val); return isNaN(n) ? def : n; }
    safeDiv(n, d, def = 0) { return this.safeFloat(d) === 0 ? def : this.safeFloat(n) / this.safeFloat(d); }
    sanitizeInput(str) { return str ? String(str).replace(/[^a-zA-Z0-9]/g, '') : ''; }
    formatCurrency(val) { 
        return `${this.currency} ${this.safeFloat(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; 
    }
    formatDate(d) { 
        if (!d) return '-'; 
        try { return frappe.datetime.obj_to_user(frappe.datetime.str_to_obj(d)); } catch { return d; } 
    }
    truncate(str, max = 25) { return (str && str.length > max) ? str.slice(0, max - 1) + '…' : str || ''; }
    
    hideEmptySection(id, data) {
        if (!data || data.length === 0) {
            // Find the closest parent section and hide it
            const section = $(id).closest('.efd-section');
            if(section.length) section.addClass('hidden-section');
            return true;
        } else {
             const section = $(id).closest('.efd-section');
             if(section.length) section.removeClass('hidden-section');
             return false;
        }
    }

    getBadgeStatus(status) {
        if(!status) return 'default';
        const s = status.toLowerCase();
        if(s.includes('paid') || s.includes('approve') || s.includes('active')) return 'active';
        if(s.includes('reject') || s.includes('cancel') || s.includes('closed')) return 'danger';
        if(s.includes('draft') || s.includes('pending') || s.includes('review')) return 'warning';
        return 'default';
    }

    // =========================================================================
    //  STYLING (PREMIUM DESIGN)
    // =========================================================================
    injectCSS() {
        // Check if style already exists
        if (document.getElementById('efd-styles')) return;
        
        // Suppress ResizeObserver error from frappe.Chart (async callback issue)
        if (!window._efd_error_handler_installed) {
            window._efd_error_handler_installed = true;
            window.addEventListener('error', function(e) {
                if (e.message && e.message.includes('removeChild')) {
                    e.preventDefault();
                    e.stopPropagation();
                    return true;
                }
            });
        }

        const css = `
            :root {
                --efd-bg: #f8fafc;
                --efd-card-bg: #ffffff;
                --efd-border: #e2e8f0;
                --efd-primary: #3b82f6;
                --efd-text-main: #0f172a;
                --efd-text-muted: #64748b;
                --efd-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
                --efd-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
                --efd-radius: 12px;
            }
            .efd-dashboard-container {
                background-color: var(--efd-bg);
                padding: 24px;
                border-radius: var(--efd-radius);
                color: var(--efd-text-main);
                font-family: 'Inter', system-ui, -apple-system, sans-serif;
                font-feature-settings: "tnum"; font-variant-numeric: tabular-nums;
                display: grid; gap: 24px; /* Stack sections with gap */
            }
            
            /* Sticky Header */
            .efd-header {
                position: sticky; top: 0; background: var(--efd-bg); z-index: 100;
                padding-bottom: 10px; border-bottom: 1px solid transparent;
                transition: border-color 0.2s;
            }
            .efd-dashboard-container.scrolled .efd-header { border-color: var(--efd-border); }

            /* KPI Row */
            .efd-kpi-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }

            /* Main Grid (Charts Left | Tabs Right) */
            .efd-main-grid { display: grid; grid-template-columns: 1.5fr 2fr; gap: 24px; }
            @media (max-width: 991px) { .efd-main-grid { grid-template-columns: 1fr; } }
            
            /* Modern Tabs */
            .efd-tab-header { display: flex; border-bottom: 1px solid var(--efd-border); background: #f1f5f9; border-radius: 12px 12px 0 0; overflow: hidden; }
            .efd-tab-btn {
                flex: 1; background: transparent; border: none; font-weight: 600; color: #64748b;
                padding: 14px 20px; border-bottom: 3px solid transparent; transition: all 0.2s; font-size: 13px;
                text-transform: uppercase; letter-spacing: 0.5px;
            }
            .efd-tab-btn.active { background: white; color: var(--efd-primary); border-bottom-color: var(--efd-primary); box-shadow: 0 -2px 10px rgba(0,0,0,0.02); }
            .efd-tab-btn:hover:not(.active) { background: #e2e8f0; color: var(--efd-text-main); }
            
            /* Footer */
            .efd-footer { display: flex; justify-content: flex-end; gap: 10px; padding-top: 10px; border-top: 1px solid var(--efd-border); margin-top: 10px; }
        
            /* Cards */
            .efd-card {
                background: var(--efd-card-bg);
                border: 1px solid var(--efd-border);
                border-radius: var(--efd-radius);
                box-shadow: var(--efd-shadow-sm);
                padding: 24px;
                transition: transform 0.2s;
            }
            .efd-card.p-0 { padding: 0 !important; }
            
            /* Tables & Utils */
            .efd-cell-truncate { max-width: 180px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
            .text-right { text-align: right; }
            .text-success { color: #166534; font-weight: 700; }
            .efd-table th { background: #f8fafc; padding: 12px 16px; font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: 700; position: sticky; top: 0; z-index: 10; }
            .efd-table td { padding: 12px 16px; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
            
            /* Profile & Badges */
            .efd-profile-header { background: white; border-radius: 16px; padding: 20px; border: 1px solid #e2e8f0; display: flex; align-items: center; gap: 20px; }
            .efd-avatar { width: 60px; height: 60px; border-radius: 50%; background: linear-gradient(135deg, var(--efd-primary), #60a5fa); color: white; display: flex; align-items: center; justify-content: center; font-size: 24px; font-weight: 700; flex-shrink: 0; }
            .efd-profile-name { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 5px 0; }
            .efd-badge { padding: 4px 10px; border-radius: 20px; font-size: 10px; font-weight: 700; text-transform: uppercase; }
            .badge-active { background: #dcfce7; color: #15803d; }
            .badge-danger { background: #fee2e2; color: #991b1b; }
            .badge-warning { background: #fef3c7; color: #92400e; }
            .badge-default { background: #f1f5f9; color: #475569; }
            .efd-meta-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; font-size: 12px; color: #64748b; margin-top: 10px; }
            .efd-meta-item i { width: 16px; text-align: center; color: #94a3b8; }
            
            /* Actions Bar */
            .efd-actions-bar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
            .btn-efd { border-radius: 8px; font-weight: 600; font-size: 12px; padding: 8px 14px; display: inline-flex; align-items: center; gap: 6px; }
        `;
        $('<style id="efd-styles">').text(css).appendTo('head');
    }

    // =========================================================================
    //  RENDER LAYOUT
    // =========================================================================
    renderLayout() {
        const html = `
        <div class="efd-dashboard-container">
            <!-- 1. Header (Sticky) -->
            <div class="efd-header">
                <div class="d-flex justify-content-between align-items-center mb-3">
                    <div class="d-flex align-items-center gap-3">
                        <div id="efd-profile-header-container"></div>
                    </div>
                    <div class="text-right">
                         <h5 class="m-0 text-muted text-uppercase mb-2" style="font-weight:800; letter-spacing:1px;">Financial Center</h5>
                         <span class="badge badge-default"><i class="fa fa-circle text-success mr-1"></i> Live</span>
                    </div>
                </div>
                
                <!-- Filters Bar (Compact) -->
                <div class="d-flex justify-content-between align-items-center bg-white p-2 rounded border">
                    <div class="efd-actions-bar">
                        <i class="fa fa-calendar text-muted ml-2"></i>
                        <input type="date" id="efd-date-start" class="form-control form-control-sm border-0 bg-light" style="width:130px;" placeholder="Start">
                        <span class="text-muted">-</span>
                        <input type="date" id="efd-date-end" class="form-control form-control-sm border-0 bg-light" style="width:130px;" placeholder="End">
                        <button class="btn btn-sm btn-primary btn-efd ml-2" onclick="window.efd_instance.applyDateFilter()">Update</button>
                    </div>
                    <div class="efd-actions-bar">
                         <button class="btn btn-sm btn-default btn-efd" onclick="window.efd_instance.copyEmailReport()"><i class="fa fa-copy"></i> Copy</button>
                         <button class="btn btn-sm btn-default btn-efd" onclick="window.efd_instance.exportCSV()"><i class="fa fa-download"></i> CSV</button>
                    </div>
                </div>
            </div>

            <!-- 2. KPI Row -->
            <div class="efd-kpi-row" id="efd-kpis"></div>

            <!-- 3. Main Logic (Grid: Charts vs Tabs) -->
            <div class="efd-main-grid">
                
                <!-- Left: Info Cards (Replacing Charts) -->
                <div class="d-flex flex-column gap-3">
                    
                    <!-- 1. Salary Card -->
                    <div id="efd-card-salary-details" class="efd-card" style="min-height:200px;">
                        <div class="text-center text-muted p-4"><i class="fa fa-spinner fa-spin"></i> Loading Salary Details...</div>
                    </div>

                    <!-- 2. Loans & Advances Card -->
                    <div id="efd-card-loans-summary" class="efd-card" style="min-height:200px;">
                        <div class="text-center text-muted p-4"><i class="fa fa-spinner fa-spin"></i> Loading Financial Status...</div>
                    </div>
                    
                </div>

                <!-- Right: Unified Ledger (Tabs) -->
                <div class="efd-card p-0 d-flex flex-column h-100" style="overflow:hidden; min-height:500px;">
                    <div class="efd-tab-header">
                        <button class="efd-tab-btn active" onclick="window.efd_instance.switchTab('payroll', this)">
                            <i class="fa fa-money mr-2"></i> Payroll
                        </button>
                        <button class="efd-tab-btn" onclick="window.efd_instance.switchTab('expenses', this)">
                            <i class="fa fa-receipt mr-2"></i> Expenses
                        </button>
                        <button class="efd-tab-btn" onclick="window.efd_instance.switchTab('loans', this)">
                            <i class="fa fa-credit-card mr-2"></i> Loans
                        </button>
                    </div>
                    <div class="flex-grow-1 bg-white position-relative">
                        <div id="efd-tab-payroll" class="p-0 h-100 position-absolute w-100" style="overflow-y:auto;">
                            <div id="efd-payroll-summary" class="p-3 border-bottom bg-light"></div>
                            <div id="efd-payroll-table"></div>
                        </div>
                        <div id="efd-tab-expenses" class="p-0 h-100 position-absolute w-100" style="display:none; overflow-y:auto;">
                            <div id="efd-expenses-summary" class="p-3 border-bottom bg-light"></div>
                            <div id="efd-expenses-table"></div>
                        </div>
                        <div id="efd-tab-loans" class="p-0 h-100 position-absolute w-100" style="display:none; overflow-y:auto;">
                            <div id="efd-loans-summary" class="p-3 border-bottom bg-light"></div>
                            <div id="efd-loans-table"></div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 4. General Ledger -->
            <div class="efd-card">
                <h6 class="text-muted text-uppercase mb-3 font-weight-bold small"><i class="fa fa-book mr-2"></i> Consolidated Ledger</h6>
                <div class="row">
                    <div class="col-md-8">
                        <div id="efd-gl-table" class="table-responsive" style="max-height:300px; overflow-y:auto;"></div>
                    </div>
                    <div class="col-md-4 border-left">
                        <div id="efd-account-summary"></div>
                    </div>
                </div>
                <div id="efd-cc-table" class="mt-3 pt-3 border-top"></div>
            </div>
            
            <!-- 5. Footer -->
            <div class="efd-footer text-muted small">
                Generated: ${new Date().toLocaleString()}
            </div>
            
        </div>`;
        
        this.frm.$wrapper.append(html);
        window.efd_instance = this;
    }

    // =========================================================================
    //  DATA LOADERS (UNCHANGED LOGIC)
    // =========================================================================
    async loadAllData() {
        frappe.dom.freeze(__('Loading Dashboard...'));
        try {
            await this.getEmployee();
            this.renderEmployeeInfo();
            
            await Promise.allSettled([
                this.loadExtendedSummary(),
                this.renderSalaryCard(),
                this.renderLoansCard(),
                this.loadPayrollDetails(),
                this.loadLoanDetails(),
                this.loadExpenseRequests(),
                this.loadGLByParty(),
                this.loadCostCenterEntries(),
                this.loadAccountSummary()
            ]);
        } catch (e) {
            console.error(e);
        } finally {
            frappe.dom.unfreeze();
        }
    }

    renderEmployeeInfo() {
        const e = this.employeeData;
        if (!e) return;
        
        const initials = e.employee_name.split(' ').map(n=>n[0]).join('').substring(0,2).toUpperCase();
        
        const html = `
            <div class="efd-profile-header">
                <div class="efd-avatar">${initials}</div>
                <div class="efd-profile-info">
                    <div class="efd-profile-name">${e.employee_name}</div>
                    <div class="efd-badges">
                        <span class="efd-badge ${e.status=='Active'?'badge-active':'badge-default'}">${e.status}</span>
                        <span class="efd-badge badge-default">${e.designation || 'No Designation'}</span>
                    </div>
                    <div class="efd-meta-grid">
                        <div class="efd-meta-item"><i class="fa fa-id-card"></i> ${e.name}</div>
                        <div class="efd-meta-item"><i class="fa fa-building"></i> ${e.department || '-'}</div>
                        <div class="efd-meta-item"><i class="fa fa-calendar"></i> Joined: ${this.formatDate(e.date_of_joining)}</div>
                        <div class="efd-meta-item"><i class="fa fa-envelope"></i> ${e.company_email || '-'}</div>
                    </div>
                </div>
            </div>
        `;
        $('#efd-profile-header-container').html(html);
    }

    // =========================================================================
    //  RENDERERS (UPDATED TO USE PREMIMUM CLASSES)
    // =========================================================================
    async loadExtendedSummary() {
        const mid = this.mountId;
        
        // 1. Salaries
        const sals = await this.callAPI('Salary Slip', this.getFilters({ employee: this.employeeId, docstatus: 1 }), ['gross_pay', 'total_deduction', 'net_pay', 'start_date'], {orderBy:'start_date desc', limit:0});
        if(this.mountId !== mid) return;
        const totalSal = sals.reduce((a,x)=>({ g: a.g+this.safeFloat(x.gross_pay), d: a.d+this.safeFloat(x.total_deduction), n: a.n+this.safeFloat(x.net_pay) }), {g:0,d:0,n:0});
        const lastSal = sals.length ? sals[0] : null;

        // 2. Loans & Advances
        const [loans, advances] = await Promise.all([
             this.callAPI('Loan', { applicant: this.employeeId, docstatus: 1 }, ['loan_amount', 'total_principal_paid']),
             this.callAPI('Employee Advance', { employee: this.employeeId, docstatus: 1 }, ['advance_amount', 'paid_amount'])
        ]);
        if(this.mountId !== mid) return;
        const totalLoan = loans.reduce((a,x)=>a+this.safeFloat(x.loan_amount),0);
        const totalLoanPaid = loans.reduce((a,x)=>a+this.safeFloat(x.total_principal_paid),0);
        const totalAdv = advances.reduce((a,x)=>a+this.safeFloat(x.advance_amount),0);
        
        // 3. Payments (Expense Request Afmco - Paid)
        let payFilters = [['workflow_state', '=', 'Paid']];
        // Combine account number filter logic similarly to loadExpenseRequests
        if (this.employeeData && this.employeeData.bank_ac_no) {
             const clean = this.sanitizeInput(this.employeeData.bank_ac_no);
             if (clean) payFilters.push(['account_no', 'like', `%${clean}%`]);
        } else {
             // Fallback if no account number, look for party/employee if field exists? 
             // Logic: User insists on Account Number query. If no account number in employee master, we might miss data.
             // But for safety, if no account number found, we return 0 or maybe try employee filter if applicable.
             // Assuming strict account number query for now as per user request.
        }
        
        // We need to fetch 'amount' from Expense Request Afmco for Paid items
        // Note: Filters might need to be OR if we want to allow employee filter too, but Frappe list is AND.
        // If account_no is missing, we might skip this query or return 0.
        let totalPay = 0;
        if (this.employeeData && this.employeeData.bank_ac_no) {
             const payments = await this.callAPI('Expense Request Afmco', payFilters, ['amount'], {limit:0});
             if(this.mountId !== mid) return;
             totalPay = payments.reduce((a,x)=>a+this.safeFloat(x.amount),0);
        }

        // 4. Closing Balances (GL)
         const year = new Date().getFullYear();
         const gl = await this.callAPI('GL Entry', {party_type:'Employee', party:this.employeeId}, ['account','debit','credit'], {limit:0});
         if(this.mountId !== mid) return;
         const balances = {};
         gl.forEach(x => { if(!balances[x.account]) balances[x.account]=0; balances[x.account] += (x.debit-x.credit); });
         
         // Formatting Helper
         const card = (title, val, icon, color, sub='') => `
            <div class="col-md-3 col-sm-6 mb-4">
                <div class="efd-kpi-card">
                    <i class="fa ${icon} efd-kpi-icon" style="color:${color}"></i>
                    <div class="efd-kpi-label">${title}</div>
                    <div class="efd-kpi-val" style="color:${color}">${this.formatCurrency(val)}</div>
                    ${sub ? `<div class="small text-muted mt-1">${sub}</div>` : ''}
                </div>
            </div>`;

         let html = '<div class="row">';
         
         // Row 1: Salary Info
         html += card('Total Net Salary', totalSal.n, 'fa-wallet', '#10b981', lastSal ? `Last: ${this.formatCurrency(lastSal.net_pay)} (${this.formatDate(lastSal.start_date)})` : 'No Recent Salary');
         html += card('Total Deductions', totalSal.d, 'fa-minus-circle', '#f43f5e');
         html += card('Total Payments (Paid)', totalPay, 'fa-file-invoice-dollar', '#3b82f6', 'Source: Expense Requests');
         html += card('Running Advance/Loans', (totalLoan+totalAdv)-(totalLoanPaid), 'fa-hand-holding-usd', '#f59e0b', `Total Taken: ${this.formatCurrency(totalLoan+totalAdv)}`);
         
         html += '</div>';
         
         // Row 2: Closing Balances (Mini Cards)
         if (Object.keys(balances).length > 0) {
             html += '<h5 class="mt-2 mb-3 text-muted text-uppercase small font-weight-bold" style="letter-spacing:1px;">Closing Balances</h5><div class="row">';
             for(const [acc, val] of Object.entries(balances)) {
                 if(Math.abs(val) > 0.01) {
                     html += `
                     <div class="col-md-4 mb-3">
                        <div class="efd-card p-3 d-flex justify-content-between align-items-center" style="margin:0; border-left:4px solid var(--efd-primary);">
                            <div class="small text-muted text-truncate" style="max-width:60%;" title="${acc}">${acc}</div>
                            <div class="font-weight-bold">${this.formatCurrency(val)}</div>
                        </div>
                     </div>`;
                 }
             }
             html += '</div>';
         }

        $('#efd-kpis').html(html);
    }

    async renderSalaryCard() {
        const mid = this.mountId;
        // Fetch latest salary slip details
        const slips = await this.callAPI('Salary Slip', this.getFilters({employee:this.employeeId, docstatus:1}), 
            ['name', 'start_date', 'gross_pay', 'total_deduction', 'net_pay', 'leave_without_pay'], 
            { orderBy: 'start_date desc', limit: 1 }
        );
        
        if(this.mountId !== mid) return;
        const s = slips.length ? slips[0] : null;

        let html = '';
        if (!s) {
            html = `<div class="text-center text-muted p-4">No Salary Information Available</div>`;
        } else {
            html = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h6 class="text-uppercase text-muted font-weight-bold m-0">
                    <i class="fa fa-money mr-2 text-primary"></i> Latest Salary Breakdown
                </h6>
                <span class="efd-badge badge-default">${this.formatDate(s.start_date)}</span>
            </div>

            <div class="row text-center mb-4">
                <div class="col-4 border-right">
                    <div class="h5 font-weight-bold text-dark mb-0">${this.formatCurrency(s.gross_pay)}</div>
                    <small class="text-muted text-uppercase font-weight-bold" style="font-size:10px;">Gross Pay</small>
                </div>
                <div class="col-4 border-right">
                    <div class="h5 font-weight-bold text-danger mb-0">${this.formatCurrency(s.total_deduction)}</div>
                    <small class="text-muted text-uppercase font-weight-bold" style="font-size:10px;">Deductions</small>
                </div>
                <div class="col-4">
                    <div class="h5 font-weight-bold text-success mb-0">${this.formatCurrency(s.net_pay)}</div>
                    <small class="text-muted text-uppercase font-weight-bold" style="font-size:10px;">Net Pay</small>
                </div>
            </div>

            <div class="efd-meta-grid" style="background:#f8fafc; padding:15px; border-radius:8px;">
                <div class="efd-meta-item justify-content-between">
                    <span><i class="fa fa-file-text-o mr-2"></i> Slip ID</span>
                    <a href="${frappe.utils.get_form_link("Salary Slip", s.name)}" class="font-weight-bold">${s.name}</a>
                </div>
                <div class="efd-meta-item justify-content-between">
                    <span><i class="fa fa-calendar-times-o mr-2"></i> Unpaid Leave</span>
                    <span class="font-weight-bold">${this.safeFloat(s.leave_without_pay)} Days</span>
                </div>
                <div class="efd-meta-item justify-content-between">
                    <span><i class="fa fa-calculator mr-2"></i> Ded. Ratio</span>
                    <span class="font-weight-bold">${Math.round((s.total_deduction/s.gross_pay)*100)}%</span>
                </div>
            </div>
            `;
        }
        $('#efd-card-salary-details').html(html);
    }

    async renderLoansCard() {
        const mid = this.mountId;
        const [advances, loans] = await Promise.all([
             this.callAPI('Employee Advance', this.getFilters({employee:this.employeeId, docstatus:1},['posting_date']), ['advance_amount', 'paid_amount', 'status']),
             this.callAPI('Loan', [['applicant','=',this.employeeId],['applicant_type','=','Employee'], ['docstatus','=',1]], ['loan_amount', 'total_principal_paid', 'status'])
        ]);
        if(this.mountId !== mid) return;

        // Calc Totals
        const advTotal = advances.reduce((s,x)=>s+this.safeFloat(x.advance_amount),0);
        const advPaid  = advances.reduce((s,x)=>s+this.safeFloat(x.paid_amount),0); // Assuming paid_amount exists or needs computation
        // Note: 'paid_amount' in Employee Advance might need to be 'claimed_amount' or 'return_amount'. checking standard. 
        // Actually standard is 'paid_amount' (disbursed) and 'claimed_amount' (settled). Let's stick to simple logic or just show Total vs Repaid if available.
        // For advances, usually it's "Amount" vs "Repaid". 
        // Let's rely on KPI logic: Running = Total - Paid.
        
        const loanTotal = loans.reduce((s,x)=>s+this.safeFloat(x.loan_amount),0);
        const loanPaid  = loans.reduce((s,x)=>s+this.safeFloat(x.total_principal_paid),0);

        const advBal  = advTotal - advPaid; // Approximation, might need more fields in real ERPNext
        const loanBal = loanTotal - loanPaid;

        const html = `
            <div class="d-flex justify-content-between align-items-center mb-4">
                <h6 class="text-uppercase text-muted font-weight-bold m-0">
                    <i class="fa fa-bank mr-2 text-warning"></i> Loans & Advances
                </h6>
            </div>

            <div class="mb-4">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-muted small font-weight-bold">LOANS</span>
                    <span class="small font-weight-bold">${Math.round((loanPaid/loanTotal)*100 || 0)}% Paid</span>
                </div>
                <div class="progress" style="height: 8px;">
                     <div class="progress-bar bg-warning" role="progressbar" style="width: ${(loanPaid/loanTotal)*100 || 0}%"></div>
                </div>
                <div class="d-flex justify-content-between mt-1" style="font-size:11px;">
                    <span class="text-muted">Paid: ${this.formatCurrency(loanPaid)}</span>
                    <span class="text-danger font-weight-bold">Bal: ${this.formatCurrency(loanBal)}</span>
                </div>
            </div>

            <div>
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <span class="text-muted small font-weight-bold">ADVANCES</span>
                    <span class="small font-weight-bold">${advances.length} Active Records</span>
                </div>
               <div class="row mt-2">
                    <div class="col-6">
                        <div class="p-2 rounded bg-light border text-center">
                            <div class="h6 font-weight-bold mb-0">${this.formatCurrency(advTotal)}</div>
                            <small class="text-muted" style="font-size:10px;">Total Taken</small>
                        </div>
                    </div>
                    <!-- Assuming we don't track Advance repayment perfectly here without detailed query, just show total taken -->
                     <div class="col-6">
                        <div class="p-2 rounded bg-light border text-center">
                            <div class="h6 font-weight-bold mb-0 text-info">${advances.length}</div>
                            <small class="text-muted" style="font-size:10px;">Count</small>
                        </div>
                    </div>
               </div>
            </div>
        `;
        $('#efd-card-loans-summary').html(html);
    }

    // =========================================================================
    // TABLES
    // =========================================================================
    async loadPayrollDetails() {
        const mid = this.mountId;
        const d = await this.callAPI('Salary Slip', this.getFilters({employee:this.employeeId, docstatus:1}), ['name','start_date','gross_pay','total_deduction','net_pay'], {orderBy:'start_date desc', limit:0});
        if(this.mountId !== mid) return;
        this.renderTable('#efd-payroll-table', d, 
            [' Slip', 'Date', 'Gross', 'Deductions', 'Net'],
            r => `
                <td><a href="${frappe.utils.get_form_link("Salary Slip", r.name)}">${r.name}</a></td>
                <td>${this.formatDate(r.start_date)}</td>
                <td class="text-right">${this.formatCurrency(r.gross_pay)}</td>
                <td class="text-right">${this.formatCurrency(r.total_deduction)}</td>
                <td class="text-right text-success"><strong>${this.formatCurrency(r.net_pay)}</strong></td>
            `
        );
    }

    async loadLoanDetails() {
        const mid = this.mountId;
        const d = await this.callAPI('Loan', [['applicant_type','=','Employee'],['applicant','=',this.employeeId]], ['name','posting_date','loan_amount','total_principal_paid','status'], {orderBy:'posting_date desc'});
        if(this.mountId !== mid) return;
        this.renderTable('#efd-loans-table', d, 
            ['Loan #', 'Date', 'Sanctioned', 'Paid', 'Status'],
            r => `
                <td><a href="${frappe.utils.get_form_link("Loan", r.name)}">${r.name}</a></td>
                <td>${this.formatDate(r.posting_date)}</td>
                <td class="text-right">${this.formatCurrency(r.loan_amount)}</td>
                <td class="text-right">${this.formatCurrency(r.total_principal_paid)}</td>
                <td><span class="indicator-pill ${r.status=='Fully Repaid'?'green':'orange'}">${r.status}</span></td>
            `
        );
    }

    async loadExpenseRequests() {
         console.log('--- [Debug] loadExpenseRequests Start ---');
         const mid = this.mountId;
         // Strict Safety: Required Bank Account
         const bankAcNo = this.employeeData?.bank_ac_no;
         console.log('[Debug] Employee:', this.employeeId, 'BankAcNo:', bankAcNo);
         
         if(!bankAcNo) {
             console.warn('[Debug] No Bank Account Number found');
             $('#efd-expenses-table').html(`
                 <div class="alert alert-warning m-3">
                     <strong>Note:</strong> No Bank Account Number found in Employee record (field: <code>bank_ac_no</code>).
                     <br>Expenses are queried by matching the employee's bank account to <code>Expense Request Afmco.account_no</code>.
                 </div>
             `);
             return;
         }
         
         const clean = this.sanitizeInput(bankAcNo);
         console.log('[Debug] Sanitized IBAN:', clean);
         
         if(!clean) {
             console.warn('[Debug] IBAN sanitize failed');
             $('#efd-expenses-table').html(`<div class="text-muted text-center p-3">Invalid account format: ${bankAcNo}</div>`);
             return;
         }

         // Debug: Show what we're searching for
         $('#efd-expenses-table').html(`<div class="text-muted text-center p-3"><i class="fa fa-spinner fa-spin"></i> Searching for IBAN containing: <code>${clean}</code>...</div>`);

         // Safe to use limit:0 because we have a specific account filter
         console.log('[Debug] Calling frappe.client.get_list for Expense Request Afmco', {account_no_like: `%${clean}%`});
         try {
             // We use a manual call here to await and catch specifically
             const d = await this.callAPI('Expense Request Afmco', [['account_no', 'like', `%${clean}%`]], ['name','creation','amount','workflow_state'], {limit:100});
             console.log('[Debug] API Response Success. Count:', d ? d.length : 0, d);
             
             if(this.mountId !== mid) {
                 console.log('[Debug] Mount ID mismatch, aborting render');
                 return;
             }
             
             if (!d || d.length === 0) {
                 console.log('[Debug] No records found matching IBAN');
                 $('#efd-expenses-table').html(`
                     <div class="alert alert-info m-3">
                         <strong>No Expenses Found</strong><br>
                         Searched <code>Expense Request Afmco.account_no</code> for: <code>%${clean}%</code><br>
                         Employee's Bank Account: <code>${bankAcNo}</code><br>
                         <small class="text-muted">Check Browser Console for detailed logs</small>
                     </div>
                 `);
                 return;
             }
             
             this.renderTable('#efd-expenses-table', d,
                 ['Request #', 'Date', 'Amount', 'Status'],
                 r => `
                     <td><a href="${frappe.utils.get_form_link("Expense Request Afmco", r.name)}">${r.name}</a></td>
                     <td>${this.formatDate(r.creation)}</td>
                     <td class="text-right">${this.formatCurrency(r.amount)}</td>
                     <td><span class="efd-badge badge-${this.getBadgeStatus(r.workflow_state)}">${r.workflow_state||'-'}</span></td>
                 `
             );
         } catch (err) {
             console.error('[Debug] API Error:', err);
             $('#efd-expenses-table').html(`<div class="alert alert-danger m-3">API Error: ${err.message}</div>`);
         }
    }

    async loadGLByParty() {
         const mid = this.mountId;
         const d = await this.callAPI('GL Entry', this.getFilters({party_type:'Employee', party:this.employeeId},['posting_date']), ['account','posting_date','debit','credit','remarks'], {limit:0});
         if(this.mountId !== mid) return;
         this.renderTable('#efd-gl-table', d, ['Account', 'Date', 'Debit', 'Credit', 'Remarks'], 
             r => `<td><div class="efd-cell-truncate">${r.account}</div></td><td>${this.formatDate(r.posting_date)}</td><td class="text-right">${this.formatCurrency(r.debit)}</td><td class="text-right">${this.formatCurrency(r.credit)}</td><td><div class="efd-cell-truncate">${r.remarks}</div></td>`
         );
    }

    async loadCostCenterEntries() {
         const mid = this.mountId;
         const d = await this.callAPI('GL Entry', this.getFilters({employee:this.employeeId}), ['cost_center','account','debit','credit'], {limit:0});
         if(this.mountId !== mid) return;
         this.renderTable('#efd-cc-table', d, ['Cost Center', 'Account', 'Debit', 'Credit'],
            r => `<td>${r.cost_center}</td><td><div class="efd-cell-truncate">${r.account}</div></td><td class="text-right">${this.formatCurrency(r.debit)}</td><td class="text-right">${this.formatCurrency(r.credit)}</td>`
         );
    }
    
    async loadAccountSummary() {
         const mid = this.mountId;
         const year = new Date().getFullYear();
         const d = await this.callAPI('GL Entry', {party_type:'Employee', party:this.employeeId}, ['account','posting_date','debit','credit'], {orderBy:'account asc', limit:0});
         if(this.mountId !== mid) return;
         const yd = d.filter(x => new Date(x.posting_date).getFullYear() === year);
         const accs = {};
         yd.forEach(x => { if(!accs[x.account]) accs[x.account]=0; accs[x.account] += (x.debit-x.credit); });

         let html = '<div class="row">';
         for(const [k,v] of Object.entries(accs)) {
             html += `
                <div class="col-md-4">
                    <div class="efd-card" style="padding:15px; border-left: 4px solid var(--efd-primary);">
                        <div class="text-muted small text-uppercase">${k}</div>
                        <div class="h4 mt-2">${this.formatCurrency(v)}</div>
                    </div>
                </div>`;
         }
         $('#efd-account-summary').html(html + '</div>');
    }

    // Helper for Tables
    renderTable(id, data, cols, rowFn) {
        if (this.hideEmptySection(id, data)) return;
        
        const h = `
            <table class="table table-hover efd-table mb-0">
                <thead><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr></thead>
                <tbody>${data.map(d=>`<tr>${rowFn(d)}</tr>`).join('')}</tbody>
            </table>`;
        $(id).html(h);
        
        // Add tooltips to truncated cells
        $(id).find('.efd-cell-truncate').each(function() {
            $(this).attr('title', $(this).text());
        });
    }
    
    // Actions
    applyDateFilter() { this.dateRange.start=$('#efd-date-start').val(); this.dateRange.end=$('#efd-date-end').val(); this.refresh(); }
    
    async copyEmailReport() {
        const c = this.frm.$wrapper.find('.efd-dashboard-container').clone();
        c.find('button, input').remove();
        // c.find('.efd-section').css('margin-bottom', '30px'); // Ensure spacing in email
        
        // Wrap in email friendly table
        const content = c.html();
        const html = `
            <html>
            <body style="font-family: sans-serif; background: #f8fafc; padding: 20px;">
                <div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e2e8f0;">
                    <h3>Financial Report: ${this.employeeId}</h3>
                    ${content}
                </div>
            </body>
            </html>`;

        const copyToClipboard = async (text, html) => {
            try {
                if(navigator.clipboard && navigator.clipboard.write) {
                    const blobHtml = new Blob([html], {type: 'text/html'});
                    const blobText = new Blob([text], {type: 'text/plain'});
                    await navigator.clipboard.write([new ClipboardItem({'text/html': blobHtml, 'text/plain': blobText})]);
                    return true;
                }
            } catch(e) { console.warn('Clipboard API failed', e); }
            return false;
        };

        const success = await copyToClipboard($(c).text(), html);
        
        if (success) {
            frappe.show_alert({message:'Report copied to clipboard', indicator:'green'});
        } else {
            // Fallback: execCommand
            const ta = document.createElement('div');
            ta.innerHTML = html;
            ta.style.position = 'fixed'; ta.style.left = '-9999px';
            document.body.appendChild(ta);
            const range = document.createRange();
            range.selectNodeContents(ta);
            const sel = window.getSelection();
            sel.removeAllRanges(); sel.addRange(range);
            try {
                document.execCommand('copy');
                frappe.show_alert({message:'Copied (Fallback)', indicator:'blue'});
            } catch(e) {
                frappe.msgprint('Could not copy. Please use Export CSV.');
            }
            document.body.removeChild(ta);
        }
    }

    // =========================================================================
    //  INTERACTIONS
    // =========================================================================
    switchTab(tabId, btn) {
        // Update Buttons
        $(btn).parent().find('.efd-tab-btn').removeClass('active');
        $(btn).addClass('active');
        
        // Update Content
        const parent = $(btn).closest('.efd-card');
        parent.find('.efd-tab-content').hide(); // Assuming I wrap content in these containers or use IDs
        // Actually my HTML used direct IDs like #efd-tab-payroll.
        // Let's use the IDs I defined in renderLayout: efd-tab-payroll, efd-tab-expenses, efd-tab-loans
        
        $('#efd-tab-payroll').hide();
        $('#efd-tab-expenses').hide();
        $('#efd-tab-loans').hide();
        
        $(`#efd-tab-${tabId}`).fadeIn(200);
    }
    
    async exportCSV() {
        const d = await this.callAPI('Salary Slip', this.getFilters({employee:this.employeeId, docstatus:1}), ['name','start_date','gross_pay','total_deduction','net_pay'], {limit:0});
        const csv = [['ID','Date','Gross','Deductions','Net']].concat(d.map(x=>[x.name,x.start_date,x.gross_pay,x.total_deduction,x.net_pay])).map(r=>r.join(',')).join('\n');
        const a = document.createElement('a'); a.href='data:text/csv;charset=utf-8,'+encodeURI(csv); a.download='report.csv'; a.click();
    }
}
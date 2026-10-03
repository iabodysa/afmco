frappe.ui.form.on('Sponsor', {
    refresh(frm) {
        load_employee_dashboard(frm);
    }
});

function load_employee_dashboard(frm) {
    frappe.call({
        method: 'frappe.client.get_list',
        args: {
            doctype: 'Employee',
            filters: {
                'custom_ajeer_from': frm.doc.sponsor_name
            },
            fields: ['name', 'employee_name', 'status', 'department', 'project_branch', 'designation', 'date_of_joining', 'basic_wage', 'company'],
            limit_page_length: 1000
        },
        callback: function(r) {
            if (r.message && r.message.length > 0) {
                render_employee_dashboard(frm, r.message);
            } else {
                render_empty_dashboard(frm);
            }
        }
    });
}

function render_employee_dashboard(frm, employees) {
    const stats = analyze_employee_data(employees);
    
    const dashboard_html = `
        <div class="form-dashboard">
            <div class="form-dashboard-section">
                <div class="dashboard-chart-container">
                    <div class="dashboard-chart-heading">
                        <h5>Employee Statistics</h5>
                        <span class="text-muted">Sponsor: ${frm.doc.sponsor_name}</span>
                    </div>
                    
                    <div class="row">
                        <div class="col-sm-3">
                            <div class="form-dashboard-item">
                                <div class="form-dashboard-item-label">Total Employees</div>
                                <div class="form-dashboard-item-value">${stats.total}</div>
                            </div>
                        </div>
                        <div class="col-sm-3">
                            <div class="form-dashboard-item">
                                <div class="form-dashboard-item-label">Active</div>
                                <div class="form-dashboard-item-value text-success">${stats.active}</div>
                            </div>
                        </div>
                        <div class="col-sm-3">
                            <div class="form-dashboard-item">
                                <div class="form-dashboard-item-label">Inactive</div>
                                <div class="form-dashboard-item-value text-danger">${stats.inactive}</div>
                            </div>
                        </div>
                        <div class="col-sm-3">
                            <div class="form-dashboard-item">
                                <div class="form-dashboard-item-label">Average Salary</div>
                                <div class="form-dashboard-item-value">${stats.avgSalary} SAR</div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="form-dashboard-section">
                <div class="dashboard-chart-container">
                    <div class="dashboard-chart-heading">
                        <h5>Project Distribution</h5>
                    </div>
                    <div class="row">
                        ${generate_project_cards(stats.projects)}
                    </div>
                </div>
            </div>

            <div class="form-dashboard-section">
                <div class="dashboard-chart-container">
                    <div class="dashboard-chart-heading">
                        <h5>Department Distribution</h5>
                    </div>
                    <div class="list-group">
                        ${generate_department_list(stats.departments)}
                    </div>
                </div>
            </div>

            <div class="row">
                <div class="col-sm-6">
                    <div class="form-dashboard-section">
                        <div class="dashboard-chart-container">
                            <div class="dashboard-chart-heading">
                                <h5>Active Employees (${stats.active})</h5>
                            </div>
                            <div class="list-group" style="max-height: 300px; overflow-y: auto;">
                                ${generate_employee_list(stats.activeEmployees, 'active')}
                            </div>
                        </div>
                    </div>
                </div>
                <div class="col-sm-6">
                    <div class="form-dashboard-section">
                        <div class="dashboard-chart-container">
                            <div class="dashboard-chart-heading">
                                <h5>Inactive Employees (${stats.inactive})</h5>
                            </div>
                            <div class="list-group" style="max-height: 300px; overflow-y: auto;">
                                ${generate_employee_list(stats.inactiveEmployees, 'inactive')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    frm.dashboard.add_section(dashboard_html);
}

function analyze_employee_data(employees) {
    const stats = {
        total: employees.length,
        active: 0,
        inactive: 0,
        projects: {},
        departments: {},
        activeEmployees: [],
        inactiveEmployees: [],
        totalSalary: 0,
        avgSalary: 0
    };

    employees.forEach(emp => {
        if (emp.status === 'Active') {
            stats.active++;
            stats.activeEmployees.push(emp);
        } else {
            stats.inactive++;
            stats.inactiveEmployees.push(emp);
        }

        const project = emp.project_branch || 'Not Specified';
        stats.projects[project] = (stats.projects[project] || 0) + 1;

        const department = emp.department || 'Not Specified';
        stats.departments[department] = (stats.departments[department] || 0) + 1;

        stats.totalSalary += emp.basic_wage || 0;
    });

    stats.avgSalary = stats.total > 0 ? Math.round(stats.totalSalary / stats.total) : 0;

    return stats;
}

function generate_project_cards(projects) {
    const total = Object.values(projects).reduce((a, b) => a + b, 0);
    return Object.entries(projects).map(([project, count]) => {
        const percentage = total > 0 ? ((count / total) * 100).toFixed(1) : 0;
        return `
            <div class="col-sm-4">
                <div class="form-dashboard-item">
                    <div class="form-dashboard-item-label">${project}</div>
                    <div class="form-dashboard-item-value">${count} <small class="text-muted">(${percentage}%)</small></div>
                </div>
            </div>
        `;
    }).join('');
}

function generate_department_list(departments) {
    return Object.entries(departments).map(([dept, count]) => {
        return `
            <div class="list-group-item">
                <div class="d-flex justify-content-between">
                    <span>${dept}</span>
                    <span class="badge badge-primary">${count}</span>
                </div>
            </div>
        `;
    }).join('');
}

function generate_employee_list(employees, type) {
    const statusClass = type === 'active' ? 'text-success' : 'text-danger';
    const statusIcon = type === 'active' ? 'fa-check-circle' : 'fa-times-circle';
    
    return employees.map(emp => {
        return `
            <div class="list-group-item">
                <div class="d-flex justify-content-between">
                    <div>
                        <div class="list-group-item-heading">
                            <i class="fa ${statusIcon} ${statusClass}"></i> ${emp.employee_name}
                        </div>
                        <p class="list-group-item-text text-muted">
                            ${emp.designation || 'Not Specified'} • ${emp.department || 'Not Specified'}
                        </p>
                        <small class="text-muted">Salary: ${emp.basic_wage || 0} SAR</small>
                    </div>
                    <div class="text-right">
                        <small class="text-muted d-block">${emp.name}</small>
                        <a href="#Form/Employee/${emp.name}" class="btn btn-xs btn-default">
                            <i class="fa fa-eye"></i> View
                        </a>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function render_empty_dashboard(frm) {
    const empty_html = `
        <div class="form-dashboard">
            <div class="form-dashboard-section">
                <div class="dashboard-chart-container">
                    <div class="empty-state">
                        <div class="empty-state-icon">
                            <i class="fa fa-users"></i>
                        </div>
                        <div class="empty-state-title">No Employees Found</div>
                        <div class="empty-state-subtitle">No employees are linked to this sponsor</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    frm.dashboard.add_section(empty_html);
}
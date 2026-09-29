frappe.ui.form.on('Financial Analysis Dashboard', {
    refresh: function(frm) {
        frm.page.set_title(__('Financial Analysis Dashboard', null, 'Financial Analysis Dashboard'));
      //  frm.disable_save();
        
        if (!frm.doc.financial_data_snapshot) {
            frappe.msgprint(__('No financial data. Please refresh the data first.', null, 'Financial Analysis Dashboard'));
            return;
        }
        
        try {
            const data = JSON.parse(frm.doc.financial_data_snapshot);
            renderDashboard(frm, data);
        } catch (error) {
            frappe.msgprint(__('Error reading financial data', null, 'Financial Analysis Dashboard'));
        }
    }
});

function renderDashboard(frm, data) {
   // frm.$wrapper.find('.form-layout').hide();
    const container = frm.$wrapper.find('.layout-main-section');
  //  container.empty();
    
    const wrapper = $('<div class="financial-dashboard">').appendTo(container);
    wrapper.css({
        'direction': 'rtl',
        'text-align': 'right',
        'padding': '15px'
    });
    
    renderHeader(wrapper, data);
    renderMetrics(wrapper, data);
    renderYearlyExpenseComparison(wrapper, data);
    renderTables(wrapper, data);
    renderQuarterlyExpenseAnalysis(wrapper, data);
    renderDetailedExpenseComparison(wrapper, data);
}

function renderHeader(wrapper, data) {
    const header = $(`
        <div class="frappe-card" style="margin-bottom: 20px; padding: 20px; text-align: center;">
            <h3>${data.company}</h3>
            <p>${__('Data up to Q{0} {1} • Last updated: {2}', [data.current_quarter, data.current_year, data.last_updated], 'Financial Analysis Dashboard')}</p>
        </div>
    `).appendTo(wrapper);
}

function renderMetrics(wrapper, data) {
    if (!data.complete_years || data.complete_years.length === 0) return;
    
    const latestYear = data.complete_years[0];
    const yearData = data.yearly_data[latestYear];
    const netProfit = yearData.total_income - yearData.total_expense;
    const profitMargin = yearData.total_income > 0 ? (netProfit / yearData.total_income * 100) : 0;
    
    const metricsContainer = $('<div class="row">').appendTo(wrapper);
    
    const metrics = [
        { label: __('Total Income', null, 'Financial Analysis Dashboard'), value: formatCurrency(yearData.total_income), color: 'green' },
        { label: __('Total Expenses', null, 'Financial Analysis Dashboard'), value: formatCurrency(yearData.total_expense), color: 'orange' },
        { label: __('Net Profit', null, 'Financial Analysis Dashboard'), value: formatCurrency(netProfit), color: netProfit >= 0 ? 'green' : 'red' },
        { label: __('Profit Margin', null, 'Financial Analysis Dashboard'), value: `${profitMargin.toFixed(1)}%`, color: 'blue' }
    ];
    
    metrics.forEach(metric => {
        $(`
            <div class="col-md-3 col-sm-6">
                <div class="frappe-card" style="padding: 20px; margin-bottom: 15px; text-align: center;">
                    <div class="text-muted">${metric.label}</div>
                    <h3 style="color: var(--${metric.color}); margin: 10px 0;">${metric.value}</h3>
                </div>
            </div>
        `).appendTo(metricsContainer);
    });
}

function renderYearlyExpenseComparison(wrapper, data) {
    if (!data.yearly_expense_changes || Object.keys(data.yearly_expense_changes).length === 0) return;
    
    const section = $(`<div class="frappe-card" style="margin-bottom: 20px; padding: 20px;"><h4>${__('Annual Expense Comparison', null, 'Financial Analysis Dashboard')}</h4></div>`).appendTo(wrapper);
    
    const table = $('<table class="table table-bordered">').appendTo(section);
    const thead = $(`<thead><tr><th>${__('Comparison', null, 'Financial Analysis Dashboard')}</th><th>${__('Current Expenses', null, 'Financial Analysis Dashboard')}</th><th>${__('Previous Expenses', null, 'Financial Analysis Dashboard')}</th><th>${__('Change Rate', null, 'Financial Analysis Dashboard')}</th></tr></thead>`).appendTo(table);
    const tbody = $('<tbody>').appendTo(table);
    
    Object.values(data.yearly_expense_changes).forEach(comparison => {
        const changeClass = comparison.change_percent >= 0 ? 'text-danger' : 'text-success';
        const arrow = comparison.change_percent >= 0 ? '↑' : '↓';
        
        $(`<tr>
            <td><strong>${__('{0} vs {1}', [comparison.current_year, comparison.previous_year], 'Financial Analysis Dashboard')}</strong></td>
            <td style="text-align: left;">${formatCurrency(comparison.current_expense)}</td>
            <td style="text-align: left;">${formatCurrency(comparison.previous_expense)}</td>
            <td style="text-align: left;" class="${changeClass}">${arrow} ${Math.abs(comparison.change_percent).toFixed(1)}%</td>
        </tr>`).appendTo(tbody);
    });
}

function renderTables(wrapper, data) {
    if (!data.complete_years || data.complete_years.length === 0) return;
    
    renderYearlyTable(wrapper, data, 'income', __('Annual Income', null, 'Financial Analysis Dashboard'));
    renderYearlyTable(wrapper, data, 'expense', __('Annual Expenses', null, 'Financial Analysis Dashboard'));
    renderQuarterlyTable(wrapper, data);
}

function renderYearlyTable(wrapper, data, type, title) {
    const section = $(`<div class="frappe-card" style="margin-bottom: 20px; padding: 20px;"><h4>${title}</h4></div>`).appendTo(wrapper);
    
    const table = $('<table class="table table-bordered">').appendTo(section);
    const thead = $('<thead>').appendTo(table);
    const headerRow = $('<tr>').appendTo(thead);
    
    $(`<th>${__('Item', null, 'Financial Analysis Dashboard')}</th>`).appendTo(headerRow);
    data.complete_years.forEach(year => {
        $(`<th>${year}</th>`).appendTo(headerRow);
    });
    
    if (data.complete_years.length > 1) {
        $(`<th>${__('Change %', null, 'Financial Analysis Dashboard')}</th>`).appendTo(headerRow);
    }
    
    const tbody = $('<tbody>').appendTo(table);
    const items = {};
    
    data.complete_years.forEach(year => {
        Object.entries(data.yearly_data[year][type]).forEach(([name, amount]) => {
            if (!items[name]) items[name] = {};
            items[name][year] = amount;
        });
    });
    
    const sortedItems = Object.entries(items)
        .sort((a, b) => (b[1][data.complete_years[0]] || 0) - (a[1][data.complete_years[0]] || 0))
        .slice(0, type === 'income' ? 10 : 15);
    
    sortedItems.forEach(([name, yearData]) => {
        const row = $('<tr>').appendTo(tbody);
        $(`<td><strong>${name}</strong></td>`).appendTo(row);
        
        const values = [];
        data.complete_years.forEach(year => {
            const value = yearData[year] || 0;
            values.push(value);
            $(`<td style="text-align: left;">${formatCurrency(value)}</td>`).appendTo(row);
        });
        
        if (data.complete_years.length > 1 && values[0] && values[1]) {
            const change = ((values[0] - values[1]) / values[1] * 100).toFixed(1);
            const changeClass = change >= 0 ? 'text-danger' : 'text-success';
            const arrow = change >= 0 ? '↑' : '↓';
            $(`<td style="text-align: left;" class="${changeClass}">${arrow} ${Math.abs(change)}%</td>`).appendTo(row);
        } else if (data.complete_years.length > 1) {
            $(`<td>-</td>`).appendTo(row);
        }
    });
    
    const totalRow = $('<tr class="font-weight-bold">').appendTo(tbody);
    $(`<td>${__('Total', null, 'Financial Analysis Dashboard')}</td>`).appendTo(totalRow);
    
    const totals = [];
    data.complete_years.forEach(year => {
        const total = type === 'income' ? data.yearly_data[year].total_income : data.yearly_data[year].total_expense;
        totals.push(total);
        $(`<td style="text-align: left;">${formatCurrency(total)}</td>`).appendTo(totalRow);
    });
    
    if (data.complete_years.length > 1 && totals[0] && totals[1]) {
        const change = ((totals[0] - totals[1]) / totals[1] * 100).toFixed(1);
        const changeClass = change >= 0 ? 'text-danger' : 'text-success';
        const arrow = change >= 0 ? '↑' : '↓';
        $(`<td style="text-align: left;" class="${changeClass}">${arrow} ${Math.abs(change)}%</td>`).appendTo(totalRow);
    } else if (data.complete_years.length > 1) {
        $(`<td>-</td>`).appendTo(totalRow);
    }
}

function renderQuarterlyTable(wrapper, data) {
    if (!data.quarterly_data || Object.keys(data.quarterly_data).length === 0) return;
    
    const section = $(`<div class="frappe-card" style="margin-bottom: 20px; padding: 20px;"><h4>${__('Quarterly Analysis', null, 'Financial Analysis Dashboard')}</h4></div>`).appendTo(wrapper);
    
    const table = $('<table class="table table-bordered">').appendTo(section);
    const thead = $(`<thead><tr><th>${__('Quarter', null, 'Financial Analysis Dashboard')}</th><th>${__('Income', null, 'Financial Analysis Dashboard')}</th><th>${__('Expenses', null, 'Financial Analysis Dashboard')}</th><th>${__('Net Profit', null, 'Financial Analysis Dashboard')}</th><th>${__('Profit Margin', null, 'Financial Analysis Dashboard')}</th></tr></thead>`).appendTo(table);
    const tbody = $('<tbody>').appendTo(table);
    
    Object.keys(data.quarterly_data).sort().forEach(quarter => {
        const qData = data.quarterly_data[quarter];
        const profit = qData.income - qData.expense;
        const margin = qData.income > 0 ? (profit / qData.income * 100) : 0;
        
        $(`<tr>
            <td><strong>${quarter}</strong></td>
            <td style="text-align: left;">${formatCurrency(qData.income)}</td>
            <td style="text-align: left;">${formatCurrency(qData.expense)}</td>
            <td style="text-align: left; color: ${profit >= 0 ? 'var(--green)' : 'var(--red)'};">${formatCurrency(profit)}</td>
            <td style="text-align: left;">${margin.toFixed(1)}%</td>
        </tr>`).appendTo(tbody);
    });
}

function renderQuarterlyExpenseAnalysis(wrapper, data) {
    if (!data.expense_comparisons || Object.keys(data.expense_comparisons).length === 0) return;
    
    const section = $(`<div class="frappe-card" style="margin-bottom: 20px; padding: 20px;"><h4>${__('Quarterly Expense Comparison Analysis', null, 'Financial Analysis Dashboard')}</h4></div>`).appendTo(wrapper);
    
    const table = $('<table class="table table-bordered">').appendTo(section);
    const thead = $(`<thead><tr><th>${__('Current Quarter', null, 'Financial Analysis Dashboard')}</th><th>${__('Expenses', null, 'Financial Analysis Dashboard')}</th><th>${__('Previous Quarter', null, 'Financial Analysis Dashboard')}</th><th>${__('Previous Expenses', null, 'Financial Analysis Dashboard')}</th><th>${__('Change Rate', null, 'Financial Analysis Dashboard')}</th></tr></thead>`).appendTo(table);
    const tbody = $('<tbody>').appendTo(table);
    
    Object.values(data.expense_comparisons).forEach(comparison => {
        const changeClass = comparison.change_percent >= 0 ? 'text-danger' : 'text-success';
        const arrow = comparison.change_percent >= 0 ? '↑' : '↓';
        
        $(`<tr>
            <td><strong>${comparison.current_quarter}</strong></td>
            <td style="text-align: left;">${formatCurrency(comparison.current_expense)}</td>
            <td>${comparison.previous_quarter}</td>
            <td style="text-align: left;">${formatCurrency(comparison.previous_expense)}</td>
            <td style="text-align: left;" class="${changeClass}">${arrow} ${Math.abs(comparison.change_percent).toFixed(1)}%</td>
        </tr>`).appendTo(tbody);
    });
}

function renderDetailedExpenseComparison(wrapper, data) {
    if (!data.expense_accounts || Object.keys(data.expense_accounts).length === 0) return;
    
    const section = $(`<div class="frappe-card" style="margin-bottom: 20px; padding: 20px;"><h4>${__('Expense Details for the Last 4 Quarters', null, 'Financial Analysis Dashboard')}</h4></div>`).appendTo(wrapper);
    
    const table = $('<table class="table table-bordered">').appendTo(section);
    const thead = $('<thead>').appendTo(table);
    const headerRow = $('<tr>').appendTo(thead);
    
    $(`<th>${__('Account', null, 'Financial Analysis Dashboard')}</th>`).appendTo(headerRow);
    
    if (data.last_4_quarters) {
        data.last_4_quarters.forEach(quarter => {
            $(`<th>${quarter}</th>`).appendTo(headerRow);
        });
    }
    
    const tbody = $('<tbody>').appendTo(table);
    
    const sortedAccounts = Object.entries(data.expense_accounts)
        .sort((a, b) => {
            const sumA = Object.values(a[1]).reduce((sum, val) => sum + val, 0);
            const sumB = Object.values(b[1]).reduce((sum, val) => sum + val, 0);
            return sumB - sumA;
        })
        .slice(0, 20);
    
    sortedAccounts.forEach(([accountName, quarterData]) => {
        const row = $('<tr>').appendTo(tbody);
        $(`<td><strong>${accountName}</strong></td>`).appendTo(row);
        
        if (data.last_4_quarters) {
            data.last_4_quarters.forEach(quarter => {
                const value = quarterData[quarter] || 0;
                $(`<td style="text-align: left;">${formatCurrency(value)}</td>`).appendTo(row);
            });
        }
    });
}


function formatCurrency(amount) {
    if (typeof amount !== 'number') amount = 0;
    
    const isNegative = amount < 0;
    const absAmount = Math.abs(amount);
    let result;
    
    if (absAmount >= 1000000) {
        result = (absAmount / 1000000).toFixed(1) + ' ' + __('million', null, 'Financial Analysis Dashboard');
    } else if (absAmount >= 1000) {
        result = (absAmount / 1000).toFixed(0) + ' ' + __('thousand', null, 'Financial Analysis Dashboard');
    } else {
        result = absAmount.toFixed(0);
    }
    
    return isNegative ? `(${result})` : result;
}
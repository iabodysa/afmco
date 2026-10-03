// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

frappe.query_reports["WPS"] = {
    "filters": [
        {
            "fieldname": "payroll_entry",
            "label": __("Payroll Entry"),
            "fieldtype": "Link",
            "options": "Payroll Entry",
            "reqd": 1,
            "get_query": () => ({
                query: "afmco.people_and_payroll.api.wps_report.payroll_entries_newest_first"
            })
        }
    ],
    "onload": function(report) {
        report.page.add_inner_button(__("Download WPS"), function() {
            let filters = report.get_values();
            if (!filters.payroll_entry) {
                frappe.msgprint(__("Please select Payroll Entry"));
                return;
            }
            showDialog(filters, report);
        });
    }
};

function showDialog(filters, report) {
    let dialogFields = getDialogFields(report);
    let d = new frappe.ui.Dialog({
        title: __("Download WPS"),
        fields: dialogFields,
        primary_action_label: __("Download"),
        primary_action(values) {
            handlePrimaryAction(values, filters, d); 
        }
    });
    d.show();
}

function getDialogFields(report) {
    return [
        {
            "fieldname": "bank_format",
            "label": __("Bank Format"),
            "fieldtype": "Select",
            "options": ["NCBK", "SIBC"],
            "reqd": 1
        },
        {
            "fieldname": "file_type",
            "label": __("File Type"),
            "fieldtype": "Select",
            "options": ["CSV", "Excel"],
            "reqd": 1
        },
        {
            "fieldname": "generate_cmd",
            "label": __("Generate BAT File"),
            "fieldtype": "Check",
            "depends_on": "eval:doc.file_type=='CSV'"
        },
        {
            "fieldname": "output_file_name",
            "label": __("Output File Name"),
            "fieldtype": "Data",
            "default": report.get_values().payroll_entry,
            "depends_on": "eval:doc.generate_cmd==1 && doc.file_type=='CSV'"
        }
    ];
}

function handlePrimaryAction(values, filters, dialog) {
    if (!values.bank_format || !values.file_type) {
        frappe.msgprint(__("Please select both Bank Format and File Type"));
        return;
    }

    filters.bank_format = values.bank_format;
    filters.file_type = values.file_type;
    fetchSalaryData(filters, values, dialog, values.generate_cmd);
    if (!values.generate_cmd) {
        dialog.hide();
    }
}

function fetchSalaryData(filters, values, dialog, generateCmd) {
    let all_data = [];
    const fields = [
        "payroll_entry", "labor_office_file_number", "employee", "employee_name", "bank_name", "bank_account_no", "iban_holder_name",
        "basic33", "housing33", "other_allowance33", "deduction33", "net_pay", "remark"
    ];

    function fetchData(start = 0) {
        frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Salary Slip",
                filters: { payroll_entry: filters.payroll_entry },
                fields: fields,
                limit_start: start,
                limit_page_length: 1000
            },
            callback: function(r) {
                if (Array.isArray(r.message) && r.message.length > 0) {
                    all_data = all_data.concat(r.message);
                    if (r.message.length === 1000) {
                        fetchData(start + 1000);
                    } else {
                        prepareAndShowFiles(all_data, values, filters, generateCmd, dialog);
                    }
                } else {
                    frappe.msgprint(__("No data returned from report."));
                }
            },
            error: function(error) {
                frappe.msgprint(__("Error fetching data: ") + error.message);
            }
        });
    }
    fetchData();
}

function prepareAndShowFiles(all_data, values, filters, generateCmd, dialog) {
    let groupedData = groupDataByLaborOfficeNumber(all_data);
    let files = createFiles(groupedData, values, filters);

    if (generateCmd) {
        generateCmdScript(files, values.output_file_name || 'NewFolder', dialog);
    } else {
        displayFiles(files, filters);
    }
}

function groupDataByLaborOfficeNumber(all_data) {
    return all_data.reduce((acc, row) => {
        let key = row.labor_office_file_number || "No data for WPS";
        if (!acc[key]) acc[key] = [];
        acc[key].push(row);
        return acc;
    }, {});
}

function createFiles(groupedData, values, filters) {
    let files = [];
    let fileIndex = 1;

    for (let labor_office_file_number in groupedData) {
        let rows = groupedData[labor_office_file_number].filter(row => row.net_pay > 0);
        if (rows.length === 0) continue;

        let total_net_pay = Math.floor(rows.reduce((sum, row) => sum + row.net_pay, 0));
        let file_name = `${fileIndex++}_${(labor_office_file_number || "No data for WPS")}-${values.bank_format}-${rows.length}-${(rows[0].remark || "No data for WPS")}-${total_net_pay}`;
        files.push({ name: file_name, rows: rows, file_type: values.file_type });
    }
    return files;
}

function displayFiles(files, filters) {
    let style = getStyle();
    let links = createDownloadLinks(files, filters);
    let table = createDownloadTable(links);
    frappe.msgprint(`${style}<div style="max-height: 300px; overflow-y: auto;">${table}</div>`, __("Download Files"), { size: 'large' });
}

function getStyle() {
    return `
        <style>
            .btn-primary { background-color: #007bff; border: none; color: white; padding: 5px 10px; text-align: center; text-decoration: none; display: inline-block; font-size: 14px; margin: 4px 2px; cursor: pointer; border-radius: 4px; }
            .btn-primary:hover { background-color: #0056b3; }
            .table { width: 100%; margin-bottom: 1rem; color: #212529; border-collapse: collapse; }
            .table th, .table td { padding: 0.75rem; vertical-align: top; border-top: 1px solid #dee2e6; }
            .table-bordered { border: 1px solid #dee2e6; }
            .table-bordered th, .table-bordered td { border: 1px solid #dee2e6; }
        </style>
    `;
}

function createDownloadLinks(files, filters) {
    return files.slice(0, 500).map((file, index) => `
        <tr id="file-row-${index}">
            <td>${file.name}</td>
            <td>
                <button class="btn btn-primary" onclick="handleFileDownload('${file.name}', '${encodeURIComponent(JSON.stringify(file.rows))}', '${file.file_type}', '${filters.bank_format}', 'file-row-${index}'); return false;">
                    Download
                </button>
            </td>
        </tr>
    `).join("");
}

function createDownloadTable(links) {
    return `
        <table class="table table-bordered">
            <thead>
                <tr>
                    <th>File Name</th>
                    <th>Action</th>
                </tr>
            </thead>
            <tbody>
                ${links}
            </tbody>
        </table>
    `;
}

function handleFileDownload(file_name, encoded_rows, file_type, bank_format, row_id) {
    let rows = JSON.parse(decodeURIComponent(encoded_rows));
    generateFile(rows, file_name, file_type, bank_format);
    document.getElementById(row_id).remove();
}

function generateFile(rows, file_name, file_type, bank_format) {
    let data;
    const sibcHeaders = ["Employee", "First Name", "Middle Name", "Last Name", "Bank Name", "Bank Account No.", "Basic", "Housing", "Other Allowance", "Deduction", "Net Pay", "Remark"];

    if (bank_format === "NCBK") {
        data = [ncbkHeaders()];
        rows.forEach(row => {
            data.push(ncbkRow(row));
        });
    } else {
        data = [sibcHeaders];
        rows.forEach(row => {
            let employee_name = splitEmployeeName(row.iban_holder_name || row.employee_name);
            let rowData = [
                row.employee,
                employee_name.first_name,
                employee_name.middle_name,
                employee_name.last_name,
                row.bank_name,
                row.bank_account_no,
                row.basic33,
                row.housing33,
                row.other_allowance33,
                row.deduction33,
                row.net_pay,
                row.remark || ''
            ];
            data.push(rowData);
        });
    }

    if (file_type === "Excel") {
        frappe.tools.downloadify(data, null, file_name + ".xlsx");
    } else {
        frappe.tools.downloadify(data, null, file_name + ".csv");
    }
}

function ncbkHeaders() {
    return ["Bank", "Account Number", "Total Salary", "Transaction Reference", "Employee Name", "National ID/Iqama ID", "Employee Address", "Basic Salary", "Housing Allowance", "Other Earnings", "Deductions"];
}

function ncbkRow(row) {
    return [
        row.bank_name || '',
        row.bank_account_no || '',
        row.net_pay || '',
        row.remark || '',
        row.iban_holder_name || row.employee_name || '',
        row.employee || '',
        "RUH",
        row.basic33 || '',
        row.housing33 || '',
        row.other_allowance33 || '',
        row.deduction33 || ''
    ];
}

function splitEmployeeName(full_name) {
    let parts = full_name.trim().split(' ');
    let first_name = parts[0] || "-";
    let middle_name = parts.length > 2 ? parts.slice(1, -1).join(' ') : (parts[1] || "-");
    let last_name = parts.length > 1 ? parts[parts.length - 1] : "-";
    return { first_name, middle_name, last_name };
}

function generateCmdScript(files, outputFolderName, dialog) {
    let cmd_script = `@echo off\nsetlocal enabledelayedexpansion\n`;

    cmd_script += `set "dir_name=%~dp0\\${outputFolderName}"\n`;
    cmd_script += `if not exist "%dir_name%" mkdir "%dir_name%"\n\n`;

    files.forEach(file => {
        cmd_script += `echo Creating file: "%dir_name%\\${file.name}.csv"\n`;
        cmd_script += `echo ${ncbkHeaders().join(",")} > "%dir_name%\\${file.name}.csv"\n`;
        file.rows.forEach(row => {
            cmd_script += `echo ${ncbkRow(row).map(value => `"${value}"`).join(",")} >> "%dir_name%\\${file.name}.csv"\n`;
        });
    });

    let blob = new Blob([cmd_script], { type: 'text/plain' });
    let link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `${outputFolderName}.bat`;
    link.click();
    dialog.hide();
}

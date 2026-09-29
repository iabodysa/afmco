// Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
// For license information, please see license.txt

frappe.query_reports["Salary Register WPS"] = {
	"filters": [

	]
};

// frappe.query_reports["Salary Register WPS"] = {
// 	filters: [
// 		{
// 			fieldname: "from_date",
// 			label: __("From"),
// 			fieldtype: "Date",
// 			default: frappe.datetime.add_months(frappe.datetime.get_today(), -1),
// 			reqd: 1,
// 			width: "100px",
// 		},
// 		{
// 			fieldname: "to_date",
// 			label: __("To"),
// 			fieldtype: "Date",
// 			default: frappe.datetime.get_today(),
// 			reqd: 1,
// 			width: "100px",
// 		},
// 		{
// 			fieldname: "currency",
// 			fieldtype: "Link",
// 			options: "Currency",
// 			label: __("Currency"),
// 			default: erpnext.get_currency(frappe.defaults.get_default("Company")),
// 			width: "50px",
// 		},
// 		{
// 			fieldname: "employee",
// 			label: __("Employee"),
// 			fieldtype: "Link",
// 			options: "Employee",
// 			width: "100px",
// 		},
// 		{
// 			fieldname: "company",
// 			label: __("Company"),
// 			fieldtype: "Link",
// 			options: "Company",
// 			default: frappe.defaults.get_user_default("Company"),
// 			width: "100px",
// 			reqd: 1,
// 		},
// 		{
// 			fieldname: "docstatus",
// 			label: __("Document Status"),
// 			fieldtype: "Select",
// 			options: ["Draft", "Submitted", "Cancelled"],
// 			default: "Submitted",
// 			width: "100px",
// 		},
// 	],
// };
frappe.query_reports["Salary Register WPS"] = {
    onload: function(report) {
        report.page.add_inner_button(__("Export CSV"), function() {
            export_salary_register_csv(report);
        });
    }
};

function export_salary_register_csv(report) {
    var filters = report.get_values();
    frappe.call({
        method: "frappe.desk.query_report.run",
        args: {
            report_name: "Salary Register WPS",
            filters: filters
        },
        callback: function(r) {
            if (r.message) {
                var data = r.message.result;
                var csv_data = "Bank,IBAN,Total Salary,Remark,Employee Name,ID,Address,Basic salary,Housing,Other allowances,Deductions\n"; // Adjust columns as per your report

                data.forEach(function(row) {
                    csv_data += row.bank_name + "," + row.bank_account_no + ","  + row.net_pay + "," + row.custom_remark +  ","  +  row.employee_name + "," + row.employee +  "," + row.branch +  "," +  row.custom_basic +  "," + row.custom_housing_gosi + "," + row.custom_other_allowance +  "," +  + row.custom_deductionss +  "," +"\n";
                });

                var num_rows = data.length;
                var filename = "Salary_Register_" + num_rows + "_Rows.csv";

                var blob = new Blob([csv_data], { type: 'text/csv;charset=utf-8;' });
                var link = document.createElement("a");
                if (link.download !== undefined) {
                    var url = URL.createObjectURL(blob);
                    link.setAttribute("href", url);
                    link.setAttribute("download", filename);
                    link.style.visibility = 'hidden';
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
            }
        }
    });
}

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
            let payroll_entry = report.get_values().payroll_entry;
            if (!payroll_entry) {
                frappe.msgprint(__("Please select Payroll Entry"));
                return;
            }
            let d = new frappe.ui.Dialog({
                title: __("Download WPS"),
                fields: [
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
                    }
                ],
                primary_action_label: __("Download"),
                primary_action(values) {
                    open_url_post(frappe.request.url, {
                        cmd: "afmco.people_and_payroll.api.wps_report.download",
                        payroll_entry: payroll_entry,
                        bank_format: values.bank_format,
                        file_type: values.file_type
                    });
                    d.hide();
                }
            });
            d.show();
        });
    }
};

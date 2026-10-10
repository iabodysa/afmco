from . import __version__ as app_version  # noqa: F401

app_name = "afmco"
app_title = "AFMCO"
app_publisher = "AFMCO"
app_description = "Customization for AFMCO"
app_icon = "octicon octicon-file-directory"
app_color = "grey"
app_email = "afm@afmcoltd.com"
app_license = "MIT"
required_apps = ["erpnext", "hrms", "lending"]

add_to_apps_screen = [
	{
		"name": app_name,
		"logo": "/assets/afmco/images/afmco-app-icon.svg",
		"title": app_title,
		"route": "/desk/people-and-payroll",
	}
]

before_request = [
	"afmco.desk_host.redirect_desk_to_app_host",
]

page_renderer = [
	"afmco.doctype_case_page.DocTypeCaseNotFoundPage",
]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
app_include_css = "afmco_form_grid.bundle.css"

# app_include_js = "/assets/afmco/js/afmco.js"

# include js, css files in header of web template
web_include_css = "/assets/afmco/css/login.css"

website_redirects = [
	{
		"source": r"/job_application(/.*)?",
		"target": "/careers",
		"redirect_http_status": 302,
		"forward_query_parameters": True,
	},
	{"source": r"/job(/.*)?", "target": "/careers", "redirect_http_status": 302},
	{
		"source": r"/jobs/(.+)",
		"target": r"/careers?job_route=jobs/\1",
		"redirect_http_status": 302,
	},
	{"source": r"/jobs", "target": "/careers", "redirect_http_status": 302},
]
# web_include_js = "/assets/afmco/js/afmco.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "afmco/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {
	"Additional Salary": "public/js/additional_salary.js",
	"Data Import": "public/js/data_import.js",
	"Employee": "public/js/employee.js",
	"Employee Checkin": "public/js/employee_checkin.js",
	"Journal Entry": "public/js/journal_entry.js",
	"Leave Application": "public/js/leave_application.js",
	"Loan": "public/js/loan.js",
	"Loan Application": "public/js/loan_application.js",
	"Payroll Entry": "public/js/payroll_entry.js",
	"Salary Slip": "public/js/salary_slip.js",
	"Sales Invoice": "public/js/sales_invoice_form.js",
	"Task": "public/js/task.js",
}
doctype_list_js = {
	"Employee": "public/js/employee_list.js",
	"Salary Slip": "public/js/salary_slip_list.js",
}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
#	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Installation
# ------------

# before_install = "afmco.install.before_install"
after_install = "afmco.install.after_install"
after_migrate = [
	"afmco.financial_operations.zatca_workspace.remove_premium_promotion",
	"afmco.vendor_desk_style.fill_empty_vendor_desk_style",
]

# Uninstallation
# ------------

# before_uninstall = "afmco.uninstall.before_uninstall"
# after_uninstall = "afmco.uninstall.after_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "afmco.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

permission_query_conditions = {
	"Payment Requisition": "afmco.financial_operations.doctype.payment_requisition.payment_requisition.get_permission_query_conditions",
}
#
# has_permission = {
#	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

# override_doctype_class = {
#	"ToDo": "custom_app.overrides.CustomToDo"
# }

extend_doctype_class = {
	"Additional Salary": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Appraisal": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Attendance": "afmco.people_and_payroll.attendance.AfmcoAttendance",
	"Attendance Request": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Compensatory Leave Request": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee": "afmco.people_and_payroll.employee.AfmcoEmployee",
	"Employee Advance": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Benefit Application": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Checkin": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Incentive": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Performance Feedback": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Promotion": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Referral": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Tax Exemption Declaration": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Employee Tax Exemption Proof Submission": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Expense Claim": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Goal": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Journal Entry": "afmco.financial_operations.journal_entry.AfmcoJournalEntry",
	"Leave Application": [
		"afmco.people_and_payroll.leave_application.AfmcoLeaveApplication",
		"afmco.people_and_payroll.employee.AfmcoHoldGuard",
	],
	"Leave Encashment": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Loan": "afmco.people_and_payroll.loan.AfmcoLoan",
	"Loan Repayment": "afmco.people_and_payroll.loan_repayment.AfmcoLoanRepayment",
	"Payroll Entry": "afmco.people_and_payroll.payroll_entry.AfmcoPayrollEntry",
	"Retention Bonus": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Salary Slip": "afmco.people_and_payroll.salary_slip.AfmcoSalarySlip",
	"Salary Structure Assignment": "afmco.people_and_payroll.salary_structure_assignment.AfmcoSalaryStructureAssignment",
	"Sales Invoice": "afmco.financial_operations.sales_invoice.AfmcoSalesInvoice",
	"Shift Assignment": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Shift Request": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Shift Type": "afmco.people_and_payroll.shift_type.AfmcoShiftType",
	"Timesheet": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
	"Travel Request": "afmco.people_and_payroll.employee.AfmcoHoldGuard",
}

# Scheduled Tasks
# ---------------

# Each entry replaces a database-owned Server Script of the same cadence. The frequency is the one
# the production record carried, never a fresh choice.
scheduler_events = {
	"daily": [
		"afmco.people_and_payroll.doctype.iqama_renewal_tracking.iqama_renewal_tracking.reschedule_due_trackings",
		"afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement.update_employee_status_for_settlements",
		"afmco.people_and_payroll.doctype.iqama_renewal_fee_tracking.iqama_renewal_fee_tracking.check_iqama_renewal_fee",
		"afmco.people_and_payroll.doctype.iqama_renewal_tracking.iqama_renewal_tracking.check_iqama_renewal",
		"afmco.people_and_payroll.leave_application.set_employees_on_leave",
		"afmco.financial_operations.doctype.payment_approver.payment_approver.restore_user_permissions",
	],
	"hourly": [
		"afmco.people_and_payroll.iqama.check_iqama_expiration",
	],
	"weekly": [
		"afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement.mark_paid_settlements",
	],
	"monthly": [
		"afmco.people_and_payroll.payroll.update_employee_bank_names",
		"afmco.people_and_payroll.payroll.deactivate_employees_without_salary_slip",
	],
}

# Overriding Methods
# ------------------------------
#
after_request = ["afmco.seo.add_robots_header"]

pdf_body_html = "afmco.draft_watermark.pdf_body_html"

doc_events = {
	"File": {
		"before_insert": "afmco.financial_operations.report_export.shorten_file_name",
	},
}

jinja = {
	"methods": [
		"afmco.financial_operations.asset_label.asset_qr_data_uri",
		"afmco.financial_operations.saudi_riyal.saudi_riyal_font_face",
		"afmco.financial_operations.journal_entry_print.journal_entry_trail",
		"afmco.financial_operations.journal_entry_print.money_words",
	],
}

override_whitelisted_methods = {
	"toggle_archive_view": "afmco.financial_operations.api.expense_request.toggle_archive_view",
}

regional_overrides = {
	"Saudi Arabia": {
		"erpnext.controllers.taxes_and_totals.update_itemised_tax_data": "afmco.financial_operations.itemised_tax.update_itemised_tax_data",
	},
}
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
#	"Task": "afmco.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]


# User Data Protection
# --------------------

user_data_fields = [
	{
		"doctype": "{doctype_1}",
		"filter_by": "{filter_by}",
		"redact_fields": ["{field_1}", "{field_2}"],
		"partial": 1,
	},
	{
		"doctype": "{doctype_2}",
		"filter_by": "{filter_by}",
		"partial": 1,
	},
	{
		"doctype": "{doctype_3}",
		"strict": False,
	},
	{
		"doctype": "{doctype_4}"
	}
]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
#	"afmco.auth.validate"
# ]


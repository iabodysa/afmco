app_name = "afmco"
app_title = "AFMCO"
app_publisher = "AFMCO"
app_description = "Payment Requisition, Advance Leave Salary and End of Service Settlement"
app_email = "afm@afmcoltd.com"
app_license = "MIT"
required_apps = ["erpnext", "hrms"]

app_include_js = "accounts_bot_choice.bundle.js"

permission_query_conditions = {
	"Payment Requisition": "afmco.afmco.doctype.payment_requisition.payment_requisition.get_permission_query_conditions",
}

override_doctype_class = {
	"Comment": "afmco.afmco.comment.AfmcoComment",
	"File": "afmco.afmco.file.AfmcoFile",
	"Journal Entry": "afmco.afmco.journal_entry.AfmcoJournalEntry",
}

scheduler_events = {
	"cron": {
		"* * * * *": [
			"afmco.afmco.accounts_bot_choice.republish_open_choices",
		],
	},
	"daily": [
		"afmco.afmco.doctype.end_of_service_settlement.end_of_service_settlement.update_employee_status_for_settlements",
	],
	"weekly": [
		"afmco.afmco.doctype.end_of_service_settlement.end_of_service_settlement.mark_paid_settlements",
	],
}

pdf_body_html = "afmco.draft_watermark.pdf_body_html"

jinja = {
	"methods": [
		"afmco.afmco.saudi_riyal.saudi_riyal_font_face",
		"afmco.afmco.saudi_riyal.currency_mark",
		"afmco.afmco.saudi_riyal.riyal_words",
	],
}

override_whitelisted_methods = {
	"toggle_archive_view": "afmco.afmco.api.expense_request.toggle_archive_view",
}

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.pdf import pdf_body_html as frappe_pdf_body_html

WATERMARKED = {"Payment Requisition", "Advance Leave Salary", "End of Service Settlement"}
DRAFT_WATERMARK_EXEMPT_PRINT_FORMATS = {"End of Service Settlement Statement"}


def pdf_body_html(template, args, **kwargs):
	html = frappe_pdf_body_html(template, args, **kwargs)
	doc = args.get("doc")
	print_format = kwargs.get("print_format")
	exempt = print_format and print_format.name in DRAFT_WATERMARK_EXEMPT_PRINT_FORMATS
	if doc and doc.doctype in WATERMARKED and doc.docstatus == 0 and not exempt:
		html = frappe.render_template("afmco/templates/print/draft_watermark.html", {"doc": doc}) + html
	return html

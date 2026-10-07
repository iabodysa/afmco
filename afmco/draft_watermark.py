# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.utils.pdf import pdf_body_html as frappe_pdf_body_html


def pdf_body_html(template, args, **kwargs):
	html = frappe_pdf_body_html(template, args, **kwargs)
	doc = args.get("doc")
	if doc and doc.meta.is_submittable and doc.docstatus == 0:
		html = frappe.render_template("afmco/templates/print/draft_watermark.html", {"doc": doc}) + html
	return html

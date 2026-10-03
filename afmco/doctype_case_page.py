# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.website.page_renderers.document_page import DocumentPage
from frappe.website.page_renderers.not_found_page import NotFoundPage
from frappe.website.page_renderers.static_page import StaticPage
from frappe.website.page_renderers.template_page import TemplatePage
from frappe.website.page_renderers.web_form import WebFormPage

RENDERERS_BEFORE_PRINT_PAGE = (StaticPage, WebFormPage, DocumentPage, TemplatePage)


class DocTypeCaseNotFoundPage(NotFoundPage):
	def __init__(self, path, http_status_code=None):
		super().__init__(path)

	def can_render(self):
		doctype, separator, _name = self.request_path.partition("/")
		if not separator or frappe.db.get_value("DocType", doctype) in (None, doctype):
			return False
		return not any(renderer(self.request_path).can_render() for renderer in RENDERERS_BEFORE_PRINT_PAGE)

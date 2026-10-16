# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from pypdf.errors import PdfReadError


def insert_private_file(file_name, content, damaged_message):
	try:
		return frappe.get_doc(
			{"doctype": "File", "file_name": file_name, "content": content, "is_private": 1}
		).insert(ignore_permissions=True)
	except PdfReadError:
		frappe.throw(damaged_message, frappe.ValidationError)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase

import frappe


def employee_form_script():
	with open(frappe.get_app_path("afmco", "public", "js", "employee.js")) as script:
		return script.read()


class TestEmployeeFormScript(TestCase):
	def test_employee_form_leaves_field_editing_to_docperm_and_permlevel(self):
		script = employee_form_script()
		self.assertNotIn("toggle_enable('*'", script)
		self.assertNotIn("disable_save", script)

	def test_employee_form_offers_no_edit_document_menu_item(self):
		self.assertNotIn("Edit Document", employee_form_script())

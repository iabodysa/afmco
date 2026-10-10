# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document

from afmco.people_and_payroll.iban import BANK_CODES


def validate_saudi_iban(iban):
	if not iban:
		frappe.throw(_("IBAN is missing"))
	if not iban.startswith("SA"):
		frappe.throw(_("IBAN number must start with 'SA'."))
	if len(iban) != 24:
		frappe.throw(_("IBAN No. must be exactly 24 digits. Current length: {0}").format(len(iban)))
	if not re.fullmatch(r"\d+", iban[2:]):
		frappe.throw(_("The IBAN number must have 22 digits following 'SA'."))
	bank_code = iban[4:6]
	if bank_code not in BANK_CODES:
		frappe.throw(_("Invalid bank code: {0}").format(bank_code))
	return BANK_CODES[bank_code]


class IBANUpdate(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.bank_name = validate_saudi_iban(self.iban)

	def before_submit(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.update_employee_bank_details()

	def update_employee_bank_details(self):
		if not self.employee:
			frappe.throw("Employee ID is missing")

		employee = frappe.get_doc("Employee", self.employee)

		if not employee:
			frappe.throw("Employee not found")

		if self.workflow_state == "Approved":
			if not self.iban or not self.bank_name:
				frappe.throw("IBAN or Bank Name is missing")

			try:
				employee.bank_ac_no = self.iban
				employee.bank_name = self.bank_name
				employee.iban_verified = 1

				employee.save(ignore_permissions=True)

				frappe.get_doc({
					"doctype": "Comment",
					"comment_type": "Comment",
					"reference_doctype": "Employee",
					"reference_name": employee.name,
					"content": f"IBAN and Bank Name updated via IBAN Update document {self.name}."
				}).insert(ignore_permissions=True)

			except AttributeError as e:
				frappe.log_error(f"Attribute error: {str(e)}", "IBAN Update Error")
				frappe.throw(f"Attribute error: {str(e)}")

			except Exception as e:
				frappe.log_error(f"Error updating IBAN and Bank Name: {str(e)}", "IBAN Update Error")
				frappe.throw(f"Failed to update IBAN and Bank Name: {str(e)}")

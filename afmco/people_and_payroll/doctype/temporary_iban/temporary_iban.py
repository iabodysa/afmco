# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document

from afmco.people_and_payroll.doctype.iban_update.iban_update import BANK_CODES


class TemporaryIBAN(Document):
	def validate(self):
		if not re.fullmatch(r"SA\d{22}", self.iban):
			frappe.throw(_("The IBAN number must have 22 digits following 'SA'."))
		bank_code = self.iban[4:6]
		if bank_code not in BANK_CODES:
			frappe.throw(_("Invalid bank code: {0}").format(bank_code))
		self.bank_name = BANK_CODES[bank_code]

	def before_submit(self):
		self.validate_single_active()

	def before_update_after_submit(self):
		self.validate_single_active()

	def validate_single_active(self):
		if not self.active:
			return
		active = frappe.db.exists(
			"Temporary IBAN",
			{"employee": self.employee, "docstatus": 1, "active": 1, "name": ("!=", self.name)},
		)
		if active:
			frappe.throw(_("Employee {0} already has active Temporary IBAN {1}").format(self.employee, active))

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from afmco.people_and_payroll.doctype.iban_update.iban_update import validate_saudi_iban


class TemporaryIBAN(Document):
	def validate(self):
		self.bank_name = validate_saudi_iban(self.iban)

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

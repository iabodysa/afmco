# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate

from afmco.people_and_payroll.doctype.iban_update.iban_update import validate_saudi_iban
from afmco.people_and_payroll.iban import refresh_draft_slips


class TemporaryIBAN(Document):
	def validate(self):
		self.bank_name = validate_saudi_iban(self.iban)

	def before_submit(self):
		self.validate_single_active()

	def before_update_after_submit(self):
		self.validate_single_active()

	def on_submit(self):
		refresh_draft_slips(self.employee)

	def on_update_after_submit(self):
		refresh_draft_slips(self.employee)

	def on_cancel(self):
		refresh_draft_slips(self.employee)

	def validate_single_active(self):
		if not self.active:
			return
		active = frappe.db.exists(
			"Temporary IBAN",
			{"employee": self.employee, "docstatus": 1, "active": 1, "name": ("!=", self.name)},
		)
		if active:
			frappe.throw(_("Employee {0} already has active Temporary IBAN {1}").format(self.employee, active))


def get_active_temporary_ibans(employees, on_date):
	if not employees:
		return {}
	on_date = getdate(on_date)
	return {
		row.employee: row
		for row in frappe.get_all(
			"Temporary IBAN",
			filters={"employee": ("in", list(employees)), "docstatus": 1, "active": 1},
			fields=["name", "employee", "iban", "bank_name", "iban_holder_name", "valid_from", "valid_until"],
		)
		if (not row.valid_from or row.valid_from <= on_date) and (not row.valid_until or row.valid_until >= on_date)
	}

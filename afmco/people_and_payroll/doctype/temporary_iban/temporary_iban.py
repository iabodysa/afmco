# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

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


def get_active_temporary_ibans(employees):
	if not employees:
		return {}
	return {
		row.employee: row
		for row in frappe.get_all(
			"Temporary IBAN",
			filters={"employee": ("in", list(employees)), "docstatus": 1, "active": 1},
			fields=["name", "employee", "iban", "bank_name", "iban_holder_name"],
		)
	}


def apply_active_temporary_ibans(slips):
	active = get_active_temporary_ibans({slip.employee for slip in slips})
	for slip in slips:
		if temporary_iban := active.get(slip.employee):
			slip.bank_account_no = temporary_iban.iban
			slip.bank_name = temporary_iban.bank_name
			slip.iban_holder_name = temporary_iban.iban_holder_name

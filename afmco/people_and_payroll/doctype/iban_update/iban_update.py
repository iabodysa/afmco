# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document

from afmco.people_and_payroll.iban import BANK_CODES, refresh_draft_slips

APPROVED = "Approved"
ANOTHER_PERSON = "Another person"


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
		if frappe.flags.in_install or frappe.flags.in_migrate or self.workflow_state != APPROVED:
			return
		deactivate_temporary_ibans(self.employee)
		if self.account_holder == ANOTHER_PERSON:
			self.open_temporary_iban()
		else:
			self.update_employee_bank_details()

	def on_submit(self):
		if self.workflow_state == APPROVED:
			refresh_draft_slips(self.employee)

	def on_cancel(self):
		before = self.get_doc_before_save()
		if not before or before.workflow_state != APPROVED:
			return
		if self.temporary_iban:
			temporary_iban = frappe.get_doc("Temporary IBAN", self.temporary_iban)
			if temporary_iban.docstatus == 1:
				temporary_iban.flags.ignore_permissions = True
				temporary_iban.cancel()
		else:
			self.restore_employee_bank_details()
		refresh_draft_slips(self.employee)

	def open_temporary_iban(self):
		temporary_iban = frappe.get_doc(
			{
				"doctype": "Temporary IBAN",
				"employee": self.employee,
				"iban": self.iban,
				"iban_holder_name": self.account_holder_name,
				"reason": self.note,
				"iban_update": self.name,
				"active": 1,
			}
		)
		temporary_iban.insert(ignore_permissions=True)
		temporary_iban.submit()
		self.temporary_iban = temporary_iban.name

	def update_employee_bank_details(self):
		employee = frappe.get_doc("Employee", self.employee)
		self.previous_iban = employee.bank_ac_no
		self.previous_bank_name = employee.bank_name
		self.previous_holder = employee.iban_holder_name
		employee.bank_ac_no = self.iban
		employee.bank_name = self.bank_name
		employee.iban_holder_name = self.account_holder_name
		employee.iban_verified = 1
		employee.save(ignore_permissions=True)
		employee.add_comment(
			"Comment", _("IBAN and Bank Name updated via IBAN Update document {0}.").format(self.name)
		)

	def restore_employee_bank_details(self):
		employee = frappe.get_doc("Employee", self.employee)
		if employee.bank_ac_no != self.iban or not self.previous_iban:
			employee.add_comment(
				"Comment", _("IBAN Update {0} was cancelled and the bank details were kept.").format(self.name)
			)
			return
		employee.bank_ac_no = self.previous_iban
		employee.bank_name = self.previous_bank_name
		employee.iban_holder_name = self.previous_holder
		employee.save(ignore_permissions=True)
		employee.add_comment(
			"Comment", _("Bank details restored after IBAN Update {0} was cancelled.").format(self.name)
		)


def deactivate_temporary_ibans(employee):
	for name in frappe.get_all(
		"Temporary IBAN", filters={"employee": employee, "docstatus": 1, "active": 1}, pluck="name"
	):
		temporary_iban = frappe.get_doc("Temporary IBAN", name)
		temporary_iban.active = 0
		temporary_iban.save(ignore_permissions=True)

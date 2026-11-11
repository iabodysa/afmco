# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate, nowdate

from afmco.people_and_payroll.doctype.iban_update.iban_update import validate_saudi_iban
from afmco.people_and_payroll.iban import refresh_draft_slips

PR_CREATED = "PR Created"
PAYMENT_DOCTYPES = ("Advance Leave Salary", "End of Service Settlement")


class TemporaryIBAN(Document):
	def validate(self):
		self.bank_name = validate_saudi_iban(self.iban)

	def before_submit(self):
		self.validate_single_active()

	def before_update_after_submit(self):
		self.validate_single_active()

	def on_submit(self):
		refresh_draft_slips(self.employee)
		refresh_open_payments(self.employee)

	def on_update_after_submit(self):
		refresh_draft_slips(self.employee)
		refresh_open_payments(self.employee)

	def on_cancel(self):
		refresh_draft_slips(self.employee)
		refresh_open_payments(self.employee)

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


def get_payment_bank(employee, on_date):
	temporary_iban = get_active_temporary_ibans([employee], on_date).get(employee)
	if temporary_iban:
		return frappe._dict(
			account_no=temporary_iban.iban,
			temporary_iban=temporary_iban.name,
			iban_holder_name=temporary_iban.iban_holder_name,
			bank_name=temporary_iban.bank_name,
		)
	bank = frappe.get_cached_value("Employee", employee, ["bank_ac_no", "iban_holder_name", "bank_name"], as_dict=True)
	return frappe._dict(
		account_no=bank and bank.bank_ac_no,
		temporary_iban=None,
		iban_holder_name=bank and bank.iban_holder_name,
		bank_name=bank and bank.bank_name,
	)


def set_payment_bank(doc):
	if not doc.employee or doc.pr_status == PR_CREATED:
		return
	bank = get_payment_bank(doc.employee, nowdate())
	doc.account_no = bank.account_no
	doc.temporary_iban = bank.temporary_iban


def refresh_open_payments(employee):
	for doctype in PAYMENT_DOCTYPES:
		for name in frappe.get_all(doctype, filters={"employee": employee, "docstatus": ("<", 2)}, pluck="name"):
			doc = frappe.get_doc(doctype, name)
			if doc.pr_status == PR_CREATED:
				continue
			set_payment_bank(doc)
			doc.db_set({"account_no": doc.account_no, "temporary_iban": doc.temporary_iban})

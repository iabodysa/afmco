# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import os

import frappe
from frappe import _
from frappe.utils import cint, getdate, strip_html

from afmco.people_and_payroll.iban import BANK_CODE, CHECKSUM, normalise_account, parse_saudi_iban
from afmco.people_and_payroll.private_upload import insert_private_file

EMPLOYEE = "Employee"
ANOTHER_PERSON = "Another person"
PERMANENT = "Permanent"
TEMPORARY = "Temporary"
TEXT_LIMITS = {"employee_id": 20, "account_holder_name": 140, "note": 1000}
MAX_CERTIFICATE_BYTES = 5 * 1024 * 1024
CERTIFICATE_SIGNATURES = {
	".pdf": b"%PDF-",
	".jpg": b"\xff\xd8\xff",
	".jpeg": b"\xff\xd8\xff",
	".png": b"\x89PNG\r\n\x1a\n",
}


def clean_text(values, fieldname):
	value = strip_html(str(values.get(fieldname) or "")).strip()
	if len(value) > TEXT_LIMITS[fieldname]:
		frappe.throw(_("One of the fields is too long."), frappe.ValidationError)
	return value


def iban_error(reason):
	if reason == CHECKSUM:
		return _("This IBAN is not correct. Please compare it with your IBAN certificate from the bank.")
	if reason == BANK_CODE:
		return _("This bank is not available for salary payments yet. Please contact HR.")
	return _("The IBAN starts with SA followed by 22 digits.")


def resolve_employee(employee_id):
	if not employee_id:
		frappe.throw(_("Please enter the employee ID number."), frappe.ValidationError)
	employee = frappe.db.get_value(
		"Employee", {"name": employee_id, "status": "Active"}, ["name", "employee_name"], as_dict=True
	)
	if not employee:
		frappe.throw(
			_("Please check the ID number. If it is correct, please contact HR."),
			frappe.ValidationError,
		)
	return employee


def validate_request(values):
	iban = normalise_account(values.get("iban"))
	valid, reason = parse_saudi_iban(iban)[:2]
	if not valid:
		frappe.throw(iban_error(reason), frappe.ValidationError)

	account_holder = values.get("account_holder")
	if account_holder not in (EMPLOYEE, ANOTHER_PERSON):
		frappe.throw(_("Please choose whose name the account is in."), frappe.ValidationError)
	account_holder_name, note = None, ""
	if account_holder == ANOTHER_PERSON:
		account_holder_name, note = clean_text(values, "account_holder_name"), clean_text(values, "note")
		if not account_holder_name or not note:
			frappe.throw(
				_("Please enter the account holder's name and the reason for the transfer."),
				frappe.ValidationError,
			)

	duration = values.get("duration")
	if duration not in (PERMANENT, TEMPORARY):
		frappe.throw(_("Please choose a permanent or a temporary account."), frappe.ValidationError)
	valid_from = valid_until = None
	if duration == TEMPORARY:
		if not values.get("valid_from") or not values.get("valid_until"):
			frappe.throw(_("Please enter the start and end dates of the period."), frappe.ValidationError)
		valid_from, valid_until = getdate(values.get("valid_from")), getdate(values.get("valid_until"))

	if not cint(values.get("declaration")):
		frappe.throw(_("Please confirm that the information is correct."), frappe.ValidationError)

	employee = resolve_employee(clean_text(values, "employee_id"))
	return {
		"employee": employee.name,
		"iban": iban,
		"account_holder": account_holder,
		"account_holder_name": account_holder_name or employee.employee_name,
		"note": note,
		"duration": duration,
		"valid_from": valid_from,
		"valid_until": valid_until,
		"deceleration": 1,
	}


def validate_certificate(filename, content):
	if not content:
		frappe.throw(_("Please attach the IBAN certificate from your bank."), frappe.ValidationError)
	extension = os.path.splitext(filename or "")[1].lower()
	signature = CERTIFICATE_SIGNATURES.get(extension)
	if not signature or not content.startswith(signature):
		frappe.throw(
			_("Please attach the IBAN certificate as a PDF, JPG or PNG file."), frappe.ValidationError
		)
	if len(content) > MAX_CERTIFICATE_BYTES:
		frappe.throw(
			_("The IBAN certificate file is larger than {0} MB.").format(MAX_CERTIFICATE_BYTES // (1024 * 1024)),
			frappe.ValidationError,
		)
	return extension


def create_request(values, certificate_filename=None, certificate_content=None):
	extension = validate_certificate(certificate_filename, certificate_content)
	request = validate_request(values)
	certificate = insert_private_file(
		f"iban-certificate-{frappe.generate_hash(length=10)}{extension}",
		certificate_content,
		_("The IBAN certificate file is damaged and cannot be opened. Please attach it again or attach a photo of it."),
	)
	return frappe.get_doc(
		{"doctype": "IBAN Update", **request, "iban_certificate": certificate.file_url}
	).insert(ignore_permissions=True)

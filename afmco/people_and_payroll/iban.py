# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.utils import validate_iban

BANK_CODES = {
	"78": "STCJ",
	"10": "NCBK",
	"80": "RJHI",
	"20": "RIBL",
	"05": "INMA",
	"15": "ALBI",
	"60": "BJAZ",
	"30": "ARNB",
	"55": "BSFR",
	"45": "SABB",
	"40": "SAMB",
	"65": "SIBC",
	"90": "GULF",
	"76": "BMUS",
	"98": "BNPA",
	"81": "DEUT",
	"95": "EBIL",
	"71": "NBOB",
	"75": "NBOK",
	"82": "NBPA",
	"01": "SAMA",
	"50": "AAAL",
	"83": "SBIN",
	"84": "TCZB",
	"87": "ICBK",
	"86": "CHAS",
	"36": "DBAK",
}

SAUDI_IBAN = re.compile(r"SA\d{22}")
BIC = re.compile(r"[A-Z]{4}([A-Z]{2})[A-Z0-9]{2}(?:[A-Z0-9]{3})?")
IBAN_SHAPE = re.compile(r"([A-Z]{2})\d{2}[A-Z0-9]{11,30}")
FOREIGN_ACCOUNT = re.compile(r"[A-Z0-9]{5,34}")
SEPARATORS = re.compile(r"[\s\-_]+")

MISSING = "missing"
SHAPE = "shape"
CHECKSUM = "checksum"
BANK_CODE = "bank_code"
INTERNATIONAL = "International"
SLIP_BANK_FIELDS = ("bank_name", "bank_account_no", "iban_holder_name", "temporary_iban")


def normalise_account(value) -> str:
	return SEPARATORS.sub("", str(value or "")).upper()


def mod97_valid(iban: str) -> bool:
	rearranged = iban[4:] + iban[:4]
	digits = "".join(str(int(char, 36)) for char in rearranged)
	return int(digits) % 97 == 1


def parse_saudi_iban(value) -> tuple[bool, str | None, str | None]:
	iban = normalise_account(value)
	if not iban:
		return False, MISSING, None
	if not SAUDI_IBAN.fullmatch(iban):
		return False, SHAPE, None
	if not mod97_valid(iban):
		return False, CHECKSUM, None
	bank = BANK_CODES.get(iban[4:6])
	if not bank:
		return False, BANK_CODE, None
	return True, None, bank


def validate_international_account(doc):
	doc.iban = normalise_account(doc.iban)
	doc.swift_code = normalise_account(doc.swift_code)
	if not doc.swift_code:
		frappe.throw(_("SWIFT Code is missing"))
	bic = BIC.fullmatch(doc.swift_code)
	if not bic:
		frappe.throw(_("SWIFT Code must be 8 or 11 letters and digits."))
	iban = IBAN_SHAPE.fullmatch(doc.iban)
	if bic.group(1) == "SA" or (iban and iban.group(1) == "SA"):
		frappe.throw(_("A Saudi bank account must be entered as a Saudi IBAN."))
	if not FOREIGN_ACCOUNT.fullmatch(doc.iban):
		frappe.throw(_("Account number must be 5 to 34 letters and digits."))
	if iban:
		validate_iban(doc.iban, throw=True)
	return doc.swift_code[:4]


def bank_country(swift_code):
	bic = BIC.fullmatch(swift_code or "")
	return bic and frappe.db.get_value("Country", {"code": bic.group(1).lower()})


def recorded_swift_codes(accounts):
	accounts = list({account for account in accounts if account})
	if not accounts:
		return {}
	codes = dict(
		frappe.get_all(
			"Employee",
			filters={"bank_ac_no": ("in", accounts), "swift_code": ("is", "set")},
			fields=["bank_ac_no", "swift_code"],
			as_list=True,
		)
	)
	codes.update(
		frappe.get_all(
			"Temporary IBAN",
			filters={"iban": ("in", accounts), "swift_code": ("is", "set"), "docstatus": 1, "active": 1},
			fields=["iban", "swift_code"],
			as_list=True,
		)
	)
	return codes


def refresh_draft_slips(employee):
	for name in frappe.get_all("Salary Slip", filters={"employee": employee, "docstatus": 0}, pluck="name"):
		slip = frappe.get_doc("Salary Slip", name)
		slip.pull_emp_details()
		slip.db_set({field: slip.get(field) for field in SLIP_BANK_FIELDS})

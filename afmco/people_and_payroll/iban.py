# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

import frappe

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
SEPARATORS = re.compile(r"[\s\-_]+")

MISSING = "missing"
SHAPE = "shape"
CHECKSUM = "checksum"
BANK_CODE = "bank_code"
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


def refresh_draft_slips(employee):
	for name in frappe.get_all("Salary Slip", filters={"employee": employee, "docstatus": 0}, pluck="name"):
		slip = frappe.get_doc("Salary Slip", name)
		slip.pull_emp_details()
		slip.db_set({field: slip.get(field) for field in SLIP_BANK_FIELDS})

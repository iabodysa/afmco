# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

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
	"82": "NBOP",
	"01": "SAMA",
	"50": "AAAL",
	"83": "SBOI",
	"84": "TCZT",
	"87": "ICBK",
	"86": "CHAS",
}

SAUDI_IBAN = re.compile(r"SA\d{22}")
SEPARATORS = re.compile(r"[\s\-_]+")

MISSING = "missing"
SHAPE = "shape"
CHECKSUM = "checksum"
BANK_CODE = "bank_code"


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

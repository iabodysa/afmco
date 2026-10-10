# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import random

import frappe
from frappe.tests import UnitTestCase

from afmco.people_and_payroll.doctype.iban_update.iban_update import validate_saudi_iban
from afmco.people_and_payroll.iban import BANK_CODE, CHECKSUM, MISSING, SHAPE, parse_saudi_iban


def iban(bank: str = "80", body: str | None = None) -> str:
	body = body or "".join(random.choice("0123456789") for _digit in range(18))
	bban = bank + body
	check = 98 - int("".join(str(int(char, 36)) for char in bban + "SA00")) % 97
	return f"SA{check:02d}{bban}"


def broken_checksum(value: str) -> str:
	return value[:2] + f"{(int(value[2:4]) + 1) % 100:02d}" + value[4:]


class TestSaudiIban(UnitTestCase):
	def test_valid_iban_with_spaces_and_lowercase_parses_with_its_bank(self):
		value = iban("80")
		spaced = " ".join(value[i : i + 4] for i in range(0, 24, 4)).lower()
		self.assertEqual(parse_saudi_iban(spaced), (True, None, "RJHI"))

	def test_each_defect_returns_its_own_reason(self):
		value = iban("80")
		self.assertEqual(parse_saudi_iban("")[1], MISSING)
		self.assertEqual(parse_saudi_iban("SA12345")[1], SHAPE)
		self.assertEqual(parse_saudi_iban("1234567890123456789012")[1], SHAPE)
		self.assertEqual(parse_saudi_iban(broken_checksum(value))[1], CHECKSUM)
		self.assertEqual(parse_saudi_iban(iban("99"))[1], BANK_CODE)

	def test_iban_update_validation_keeps_its_messages_and_bank_lookup(self):
		self.assertEqual(validate_saudi_iban(iban("10")), "NCBK")
		self.assertRaisesRegex(frappe.ValidationError, "start with 'SA'", validate_saudi_iban, "XX0380000000608010167519")
		self.assertRaisesRegex(frappe.ValidationError, "Invalid bank code: 99", validate_saudi_iban, iban("99"))

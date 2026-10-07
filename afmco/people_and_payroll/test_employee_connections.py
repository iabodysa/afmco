# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import csv
import json
from pathlib import Path
from unittest import TestCase

APP = Path(__file__).resolve().parents[1]
EMPLOYEE_JSON = APP / "people_and_payroll" / "custom" / "employee.json"
AR_CSV = APP / "translations" / "ar.csv"

GROUPS = {
	"End of Service Settlement": "Dues",
	"Vacation Allowance": "Dues",
	"Employee Visa": "Residency & Family",
	"Employee Dependent": "Residency & Family",
	"Employee Insurance": "Residency & Family",
}


class TestEmployeeConnections(TestCase):
	def setUp(self):
		self.doc = json.loads(EMPLOYEE_JSON.read_text(encoding="utf-8"))
		self.links = self.doc.get("links") or []

	def test_each_doctype_sits_in_its_connections_group(self):
		self.assertEqual({row["link_doctype"]: row["group"] for row in self.links}, GROUPS)

	def test_links_order_has_no_id_for_a_retired_link(self):
		links_order = next(
			json.loads(p["value"])
			for p in self.doc.get("property_setters") or []
			if p["name"] == "Employee-main-links_order"
		)
		self.assertEqual(len(links_order), len(self.links))

	def test_rows_sync_onto_employee_in_place(self):
		for row in self.links:
			self.assertEqual(
				(row["parent"], row["parentfield"], row["parenttype"], row["custom"], row["link_fieldname"]),
				("Employee", "links", "DocType", 1, "employee"),
			)
			self.assertNotIn("name", row)

	def test_group_labels_have_arabic_translations(self):
		with AR_CSV.open(encoding="utf-8") as f:
			translated = {row[0] for row in csv.reader(f) if row and row[1]}
		self.assertLessEqual(set(GROUPS.values()), translated)

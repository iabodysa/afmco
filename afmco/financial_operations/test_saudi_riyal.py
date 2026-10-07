# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from base64 import b64encode
from types import FunctionType

import frappe
from frappe.tests import UnitTestCase
from frappe.utils import scrub_urls

from afmco.financial_operations.saudi_riyal import FONT_WEIGHTS, saudi_riyal_font_face


class TestSaudiRiyalFontFace(UnitTestCase):
	def test_style_limits_every_face_to_the_riyal_code_point(self):
		style = saudi_riyal_font_face()
		self.assertEqual(style.count("@font-face"), len(FONT_WEIGHTS))
		self.assertEqual(style.count("unicode-range: U+20C1;"), len(FONT_WEIGHTS))

	def test_style_embeds_each_shipped_font_file(self):
		style = saudi_riyal_font_face()
		for file_name in FONT_WEIGHTS.values():
			with open(frappe.get_app_path("afmco", "public", "fonts", file_name), "rb") as font:
				self.assertIn(b64encode(font.read()).decode(), style)

	def test_style_survives_pdf_url_scrubbing(self):
		style = saudi_riyal_font_face()
		self.assertEqual(scrub_urls(style), style)

	def test_jinja_hook_registers_a_plain_function(self):
		self.assertIsInstance(saudi_riyal_font_face, FunctionType)

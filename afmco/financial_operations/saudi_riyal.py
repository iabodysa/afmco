# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from base64 import b64encode
from functools import cache

import frappe

FONT_WEIGHTS = {400: "SaudiRiyal-Regular.ttf", 700: "SaudiRiyal-Bold.ttf"}


@cache
def font_face_style():
	faces = []
	for weight, file_name in FONT_WEIGHTS.items():
		with open(frappe.get_app_path("afmco", "public", "fonts", file_name), "rb") as font:
			data = b64encode(font.read()).decode()
		faces.append(
			"@font-face {\n"
			'\tfont-family: "Saudi Riyal";\n'
			f'\tsrc:\n\t\turl(data:font/ttf;base64,{data}) format("truetype");\n'
			f"\tfont-weight: {weight};\n"
			"\tfont-style: normal;\n"
			"\tunicode-range: U+20C1;\n"
			"}\n"
		)
	return "<style>\n" + "".join(faces) + '.riyal {\n\tfont-family: "Saudi Riyal", sans-serif;\n}\n</style>'


def saudi_riyal_font_face():
	return font_face_style()

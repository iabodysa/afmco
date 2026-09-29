# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import os

FILE_NAME_LIMIT = 140


def shorten_file_name(doc, method=None):
	# Background report exports name the file after every filter value, which passes File.file_name's 140 characters
	name = doc.file_name or ""
	if len(name) <= FILE_NAME_LIMIT:
		return
	stem, ext = os.path.splitext(name)
	doc.file_name = stem[: FILE_NAME_LIMIT - len(ext)].rstrip(" _-") + ext

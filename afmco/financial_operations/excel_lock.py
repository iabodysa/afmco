# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import io
import zipfile

import frappe
from openpyxl import load_workbook
from openpyxl.utils.exceptions import InvalidFileException
from openpyxl.chartsheet.protection import ChartsheetProtection

SITE_CONFIG_KEY = "afmco_excel_lock_password"


def lock_password() -> str | None:
	return frappe.conf.get(SITE_CONFIG_KEY) or None


UNREADABLE = (zipfile.BadZipFile, InvalidFileException, KeyError, ValueError, TypeError, SyntaxError, OSError)


def lock(content: bytes, password: str | None) -> bytes | None:
	try:
		workbook = load_workbook(io.BytesIO(content))
	except UNREADABLE:
		return None
	for sheet in workbook.worksheets:
		if password:
			sheet.protection.set_password(password)
		else:
			sheet.protection.sheet = True
	for chartsheet in workbook.chartsheets:
		protection = chartsheet.sheetProtection or ChartsheetProtection()
		protection.content = True
		protection.objects = True
		if password:
			protection.password = password
		chartsheet.sheetProtection = protection
	workbook.security.lockStructure = True
	if password:
		workbook.security.set_workbook_password(password)
	output = io.BytesIO()
	workbook.save(output)
	return output.getvalue()

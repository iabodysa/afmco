import csv
import io
import json

import frappe

DOCTYPE = "Payment Requisition"
COLUMN = "data"


def execute():
	if not frappe.db.has_column(DOCTYPE, COLUMN):
		return
	attached = skipped = 0
	for name, data in frappe.db.sql(
		f"select name, `{COLUMN}` from `tab{DOCTYPE}` where ifnull(trim(`{COLUMN}`), '') not in ('', '[]')"
	):
		file_name = f"{name}-excel-data.csv"
		content = build_csv(data)
		if not content or frappe.db.exists(
			"File", {"attached_to_doctype": DOCTYPE, "attached_to_name": name, "file_name": file_name}
		):
			skipped += 1
			continue
		frappe.get_doc(
			{
				"doctype": "File",
				"file_name": file_name,
				"attached_to_doctype": DOCTYPE,
				"attached_to_name": name,
				"is_private": 1,
				"content": content,
			}
		).insert(ignore_permissions=True)
		attached += 1
	print(f"Payment Requisition excel data: {attached} CSV attached, {skipped} skipped")


def build_csv(data):
	try:
		rows = json.loads(data)
	except ValueError:
		return None
	if not isinstance(rows, list):
		return None
	rows = [row for row in rows if isinstance(row, dict)]
	if not rows:
		return None
	header = list(dict.fromkeys(key for row in rows for key in row))
	buffer = io.StringIO()
	writer = csv.DictWriter(buffer, fieldnames=header, lineterminator="\r\n")
	writer.writeheader()
	writer.writerows(rows)
	return buffer.getvalue().encode("utf-8-sig")

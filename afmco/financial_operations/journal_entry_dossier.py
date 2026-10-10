# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import hashlib
import json
import re

import frappe
from frappe import _

from afmco.financial_operations import requisition_pack
from afmco.financial_operations.requisition_pack import IMAGE_EXTENSIONS, JOURNAL_ENTRY

PRINT_FORMAT = "Journal Entry Voucher"
DOSSIER_PATTERN = re.compile(r"-dossier-[0-9a-f]{8}\.pdf$")
ROLES = ("Accountant", "Accounts User", "Accounts Manager")


def is_dossier(file: dict) -> bool:
	return bool(DOSSIER_PATTERN.search(file.file_name or ""))


def is_mergeable(file: dict) -> bool:
	extension = requisition_pack.file_extension(file)
	if extension != "pdf" and extension not in IMAGE_EXTENSIONS:
		return False
	return not (file.file_url or "").startswith(("http://", "https://"))


def inputs(entry) -> list[dict]:
	attached = frappe.get_all(
		"File",
		filters={"attached_to_doctype": JOURNAL_ENTRY, "attached_to_name": entry.name, "is_folder": 0},
		fields=["name", "file_name", "file_url", "file_size"],
		order_by="creation asc",
	)
	files = [f for f in attached if not is_dossier(f)]
	requisition = entry.get("expense_request_cf")
	if requisition and requisition_pack.pack_file_name(requisition) not in {f.file_name for f in files}:
		files += requisition_pack.requisition_files(requisition)
	return files


def dossier_file_name(entry, files: list[dict]) -> str:
	key = json.dumps([entry.docstatus, sorted([f.name, f.file_url, f.file_size or 0] for f in files)])
	return f"{entry.name}-dossier-{hashlib.sha1(key.encode()).hexdigest()[:8]}.pdf"


def print_format() -> str | None:
	return PRINT_FORMAT if frappe.db.exists("Print Format", PRINT_FORMAT) else None


def build(journal_entry: str) -> dict:
	entry = frappe.get_doc(JOURNAL_ENTRY, journal_entry)
	files = inputs(entry)
	file_name = dossier_file_name(entry, files)
	listed = [f.file_name for f in files if not is_mergeable(f)]
	url = frappe.db.get_value(
		"File",
		{"attached_to_doctype": JOURNAL_ENTRY, "attached_to_name": journal_entry, "file_name": file_name},
		"file_url",
	)
	if url:
		return {"file_url": url, "listed": listed, "skipped": []}

	cover = frappe.get_print(JOURNAL_ENTRY, journal_entry, print_format(), as_pdf=True)
	content, excluded = requisition_pack.merge(
		cover, files, requisition_pack.input_size(files) > requisition_pack.DOWNSAMPLE_THRESHOLD
	)
	for previous in frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": JOURNAL_ENTRY,
			"attached_to_name": journal_entry,
			"file_name": ["like", "%-dossier-%.pdf"],
		},
		fields=["name", "file_name"],
	):
		if is_dossier(previous):
			frappe.delete_doc("File", previous.name)
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": JOURNAL_ENTRY,
			"attached_to_name": journal_entry,
			"is_private": 1,
			"content": content,
		}
	).insert()
	skipped = [name for name in excluded if name not in listed]
	if listed or skipped:
		entry.add_comment(
			"Info",
			_("{0} does not include: {1}").format(file_name, ", ".join(listed + skipped)),
		)
	return {"file_url": file.file_url, "listed": listed, "skipped": skipped}


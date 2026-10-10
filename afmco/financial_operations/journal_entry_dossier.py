# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import hashlib
import io
import json
import re
from pathlib import Path

import frappe
import pikepdf
from frappe import _
from frappe.utils.pdf import get_pdf

from afmco.financial_operations import requisition_pack
from afmco.financial_operations.requisition_pack import IMAGE_EXTENSIONS, JOURNAL_ENTRY

PRINT_FORMAT = "Journal Entry Voucher"
INDEX_TEMPLATE = "afmco/templates/print/journal_entry_dossier_index.html"
LEGACY_PATTERN = re.compile(r"-dossier-[0-9a-f]{8}\.pdf$")
ROLES = ("Accountant", "Accounts User", "Accounts Manager")
SKIPPED_KEY = "/AfmcoSkipped"
INPUTS_KEY = "/AfmcoInputs"


def dossier_file_name(journal_entry: str) -> str:
	return f"{journal_entry}.pdf"


def recorded(file: dict, key: str) -> str | None:
	try:
		with pikepdf.Pdf.open(Path(frappe.get_doc("File", file.name).get_full_path())) as pdf:
			value = pdf.docinfo.get(key)
			return str(value) if value is not None else None
	except (pikepdf.PdfError, OSError):
		return None


def is_dossier(journal_entry: str, file: dict) -> bool:
	name = file.file_name or ""
	if LEGACY_PATTERN.search(name):
		return True
	return name.startswith(journal_entry) and name.endswith(".pdf") and recorded(file, INPUTS_KEY) is not None


def split(journal_entry: str) -> tuple[list[dict], list[dict]]:
	files, dossiers = [], []
	for file in frappe.get_all(
		"File",
		filters={"attached_to_doctype": JOURNAL_ENTRY, "attached_to_name": journal_entry, "is_folder": 0},
		fields=["name", "file_name", "file_url", "file_size"],
		order_by="creation asc",
	):
		(dossiers if is_dossier(journal_entry, file) else files).append(file)
	return files, dossiers


def is_mergeable(file: dict) -> bool:
	extension = requisition_pack.file_extension(file)
	if extension != "pdf" and extension not in IMAGE_EXTENSIONS:
		return False
	return not (file.file_url or "").startswith(("http://", "https://"))


def inputs_key(entry, files: list[dict]) -> str:
	key = json.dumps([entry.docstatus, sorted([f.name, f.file_url, f.file_size or 0] for f in files)])
	return hashlib.sha1(key.encode()).hexdigest()


def current(entry, files: list[dict], dossiers: list[dict]) -> dict | None:
	key = inputs_key(entry, files)
	return next((d for d in dossiers if recorded(d, INPUTS_KEY) == key), None)


def print_format() -> str | None:
	return PRINT_FORMAT if frappe.db.exists("Print Format", PRINT_FORMAT) else None


def page_count(content: bytes | Path) -> int:
	with pikepdf.Pdf.open(content if isinstance(content, Path) else io.BytesIO(content)) as pdf:
		return len(pdf.pages)


def source_pages(file: dict) -> int:
	if requisition_pack.file_extension(file) == "pdf":
		return page_count(Path(frappe.get_doc("File", file.name).get_full_path()))
	return 1


def index_rows(cover: bytes, files: list[dict], excluded: list[str]) -> tuple[list[dict], int]:
	rows = []
	end = page_count(cover)
	for file in files:
		pages = 0 if file.file_name in excluded else source_pages(file)
		rows.append(
			frappe._dict(
				file_name=file.file_name or file.file_url,
				file_type=requisition_pack.file_extension(file).upper(),
				first=end + 1 if pages else None,
				last=end + pages if pages else None,
				merged=bool(pages),
			)
		)
		end += pages
	return rows, end


def finish(merged: bytes, index: bytes, info: dict[str, str]) -> bytes:
	output = io.BytesIO()
	with pikepdf.Pdf.open(io.BytesIO(merged)) as pdf, pikepdf.Pdf.open(io.BytesIO(index)) as tail:
		pdf.pages.extend(tail.pages)
		for key, value in info.items():
			pdf.docinfo[key] = value
		pdf.save(output, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
	return output.getvalue()


def build(journal_entry: str) -> dict:
	entry = frappe.get_doc(JOURNAL_ENTRY, journal_entry)
	files, dossiers = split(journal_entry)
	listed = [f.file_name for f in files if not is_mergeable(f)]
	cached = current(entry, files, dossiers)
	if cached:
		return {"file_url": cached.file_url, "listed": listed, "skipped": json.loads(recorded(cached, SKIPPED_KEY) or "[]")}

	cover = frappe.get_print(JOURNAL_ENTRY, journal_entry, print_format(), as_pdf=True)
	merged, excluded = requisition_pack.merge(
		cover, files, requisition_pack.input_size(files) > requisition_pack.DOWNSAMPLE_THRESHOLD
	)
	skipped = [name for name in excluded if name not in listed]
	rows, end = index_rows(cover, files, excluded)
	index = get_pdf(frappe.render_template(INDEX_TEMPLATE, {"entry": entry, "rows": rows}))
	expected = end + page_count(index)
	content = finish(merged, index, {INPUTS_KEY: inputs_key(entry, files), SKIPPED_KEY: json.dumps(skipped)})
	actual = page_count(content)
	if actual != expected:
		error = _("{0} has {1} pages, expected {2}; the previous print with attachments is kept.").format(
			dossier_file_name(journal_entry), actual, expected
		)
		frappe.log_error(
			title=_("Journal Entry dossier check failed"),
			message=error,
			reference_doctype=JOURNAL_ENTRY,
			reference_name=journal_entry,
		)
		return {"error": error, "listed": listed, "skipped": skipped}
	for dossier in dossiers:
		frappe.delete_doc("File", dossier.name)
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": dossier_file_name(journal_entry),
			"attached_to_doctype": JOURNAL_ENTRY,
			"attached_to_name": journal_entry,
			"is_private": 1,
			"content": content,
		}
	).insert()
	if listed or skipped:
		entry.add_comment(
			"Info",
			_("{0} does not include: {1}").format(file.file_name, ", ".join(listed + skipped)),
		)
	return {"file_url": file.file_url, "listed": listed, "skipped": skipped}

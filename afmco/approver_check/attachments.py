# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import hashlib
import re
from datetime import timedelta
from pathlib import Path

import frappe
import pikepdf
from frappe import _
from frappe.utils import cstr
from PIL import Image, UnidentifiedImageError

from afmco.approver_check.model import Context, evidence
from afmco.financial_operations.requisition_pack import IMAGE_EXTENSIONS

URL_PREFIXES = ("http://", "https://")
PDF_DATE = re.compile(r"D:(\d{4})(\d{2})?(\d{2})?")
EDITOR_PRODUCERS = ("photoshop", "illustrator", "gimp", "canva", "ilovepdf", "smallpdf", "sejda", "pdfescape", "phantompdf", "nitro", "pdf-xchange", "inkscape")
METADATA_GAP = timedelta(days=1)
KILOBYTE = 1024

MISSING = "missing"
REMOTE = "remote"
UNREADABLE = "unreadable"
UNSUPPORTED = "unsupported"
READABLE = "readable"


def attached_files(ctx: Context, doctype: str | None = None, name: str | None = None) -> list[dict]:
	doctype = doctype or ctx.doc.doctype
	name = name or ctx.doc.name
	return ctx.remember(
		("files", doctype, name),
		lambda: frappe.get_all(
			"File",
			filters={"attached_to_doctype": doctype, "attached_to_name": name, "is_folder": 0},
			fields=["name", "file_name", "file_url", "file_size", "is_private", "content_hash", "owner", "creation"],
			order_by="creation asc",
		),
	)


def current_files(doctype: str, name: str) -> list[dict]:
	return frappe.get_all(
		"File",
		filters={"attached_to_doctype": doctype, "attached_to_name": name, "is_folder": 0},
		fields=["name", "content_hash"],
	)


def files_hash(files: list[dict]) -> str:
	listed = sorted(f"{file.name}:{cstr(file.content_hash)}" for file in files)
	return hashlib.sha256("\n".join(listed).encode()).hexdigest()


def file_evidence(files: list[dict]) -> list[dict]:
	return [evidence(_("File"), f"{f.file_name} ({(f.file_size or 0) / KILOBYTE:.0f} KB)", "File", f.name) for f in files]


def extension(file: dict) -> str:
	return Path(file.file_name or file.file_url or "").suffix.lower().lstrip(".")


def local_path(file: dict) -> Path | None:
	if cstr(file.file_url).startswith(URL_PREFIXES):
		return None
	return Path(frappe.get_doc("File", file.name).get_full_path())


def readability(file: dict) -> str:
	if cstr(file.file_url).startswith(URL_PREFIXES):
		return REMOTE
	path = local_path(file)
	if not path.is_file():
		return MISSING
	kind = extension(file)
	try:
		if kind == "pdf":
			with pikepdf.open(path):
				return READABLE
		if kind in IMAGE_EXTENSIONS:
			with Image.open(path) as image:
				image.verify()
			return READABLE
	except pikepdf.PdfError, pikepdf.PasswordError, UnidentifiedImageError, OSError, SyntaxError:
		return UNREADABLE
	return UNSUPPORTED


def pdf_date(value):
	match = PDF_DATE.match(cstr(value))
	if not match:
		return None
	year, month, day = (int(part or 1) for part in match.groups())
	try:
		return frappe.utils.getdate(f"{year:04d}-{month:02d}-{day:02d}")
	except Exception:
		return None


def pdf_edit_signs(path: Path) -> list[str]:
	raw = path.read_bytes()
	signs = []
	revisions = raw.count(b"%%EOF") - 1
	if revisions > 0:
		signs.append(_("{0} incremental update(s)").format(revisions))
	with pikepdf.open(path) as pdf:
		info = pdf.docinfo
		created = pdf_date(info.get("/CreationDate"))
		modified = pdf_date(info.get("/ModDate"))
		producer = cstr(info.get("/Producer")).lower()
	if created and modified and modified - created > METADATA_GAP:
		signs.append(_("modified on {0}, created on {1}").format(modified, created))
	editor = next((name for name in EDITOR_PRODUCERS if name in producer), None)
	if editor:
		signs.append(_("produced by an editor: {0}").format(producer))
	return signs

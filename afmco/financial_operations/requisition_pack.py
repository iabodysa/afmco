# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import io
from pathlib import Path

import frappe
import pikepdf
from PIL import Image, ImageOps, UnidentifiedImageError

from afmco.financial_operations import excel_lock

PAYMENT_REQUISITION = "Payment Requisition"
JOURNAL_ENTRY = "Journal Entry"
PRINT_FORMAT = "Payment Request Form"
MEGABYTE = 1024 * 1024
BACKGROUND_THRESHOLD = 5 * MEGABYTE
DOWNSAMPLE_THRESHOLD = 8 * MEGABYTE
DOWNSAMPLE_DPI = 150
DOWNSAMPLE_QUALITY = 75
A4_INCHES = (8.27, 11.69)
IMAGE_EXTENSIONS = {"png", "jpg", "jpeg", "gif", "bmp", "tif", "tiff", "webp"}
EXCEL_EXTENSIONS = {"xlsx", "xls"}


def pack_file_name(requisition: str) -> str:
	return f"{requisition}-pack.pdf"


def requisition_files(requisition: str) -> list[dict]:
	return frappe.get_all(
		"File",
		filters={"attached_to_doctype": PAYMENT_REQUISITION, "attached_to_name": requisition, "is_folder": 0},
		fields=["name", "file_name", "file_url", "file_size"],
		order_by="creation asc",
	)


def input_size(files: list[dict]) -> int:
	return sum(f.file_size or 0 for f in files)


def image_pdf(content: bytes, downsample: bool) -> pikepdf.Pdf:
	image = ImageOps.exif_transpose(Image.open(io.BytesIO(content)))
	if image.mode in ("RGBA", "LA") or "transparency" in image.info:
		image = image.convert("RGBA")
		background = Image.new("RGB", image.size, "white")
		background.paste(image, mask=image.getchannel("A"))
		image = background
	else:
		image = image.convert("RGB")
	page = A4_INCHES if image.height >= image.width else A4_INCHES[::-1]
	options = {}
	if downsample:
		image.thumbnail((int(page[0] * DOWNSAMPLE_DPI), int(page[1] * DOWNSAMPLE_DPI)))
		options["quality"] = DOWNSAMPLE_QUALITY
	output = io.BytesIO()
	image.save(output, "PDF", resolution=max(image.width / page[0], image.height / page[1]), **options)
	return pikepdf.Pdf.open(io.BytesIO(output.getvalue()))


def file_extension(file: dict) -> str:
	return Path(file.file_name or file.file_url or "").suffix.lower().lstrip(".")


def attachment_pdf(file: dict, downsample: bool) -> pikepdf.Pdf | None:
	extension = file_extension(file)
	if extension != "pdf" and extension not in IMAGE_EXTENSIONS:
		return None
	if (file.file_url or "").startswith(("http://", "https://")):
		return None
	content = Path(frappe.get_doc("File", file.name).get_full_path()).read_bytes()
	try:
		if extension == "pdf":
			return pikepdf.Pdf.open(io.BytesIO(content))
		return image_pdf(content, downsample)
	except (pikepdf.PdfError, pikepdf.PasswordError, UnidentifiedImageError, OSError):
		return None


def merge(cover: bytes, files: list[dict], downsample: bool) -> tuple[bytes, list[str]]:
	sources = [pikepdf.Pdf.open(io.BytesIO(cover))]
	skipped = []
	for file in files:
		pdf = attachment_pdf(file, downsample)
		if pdf is None:
			skipped.append(file.file_name)
		else:
			sources.append(pdf)
	pack = pikepdf.Pdf.new()
	for source in sources:
		pack.pages.extend(source.pages)
	output = io.BytesIO()
	pack.save(output, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
	return output.getvalue(), skipped


def attach(requisition: str, journal_entry: str) -> dict:
	files = requisition_files(requisition)
	cover = frappe.get_print(PAYMENT_REQUISITION, requisition, PRINT_FORMAT, as_pdf=True)
	content, skipped = merge(cover, files, input_size(files) > DOWNSAMPLE_THRESHOLD)
	file_name = pack_file_name(requisition)
	for previous in frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": JOURNAL_ENTRY,
			"attached_to_name": journal_entry,
			"file_name": file_name,
		},
		pluck="name",
	):
		frappe.delete_doc("File", previous)
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
	separate = attach_excel(files, journal_entry)
	return {
		"file_url": file.file_url,
		"skipped": [name for name in skipped if name not in separate["originals"]],
		"attached": separate["locked"],
		"not_locked": separate["not_locked"],
	}


def locked_file_name(file_name: str) -> str:
	return f"{Path(file_name).stem}-locked.xlsx"


def attach_excel(files: list[dict], journal_entry: str) -> dict:
	excel = [f for f in files if file_extension(f) in EXCEL_EXTENSIONS]
	attached = set(
		frappe.get_all(
			"File",
			filters={"attached_to_doctype": JOURNAL_ENTRY, "attached_to_name": journal_entry},
			pluck="file_name",
		)
	)
	password = excel_lock.lock_password()
	locked, not_locked = [], []
	for f in excel:
		if file_extension(f) == "xls":
			if f.file_name not in attached:
				frappe.get_doc("File", f.name).create_attachment_copy(JOURNAL_ENTRY, journal_entry)
				attached.add(f.file_name)
			not_locked.append(f.file_name)
			continue
		name = locked_file_name(f.file_name)
		if name not in attached:
			content = Path(frappe.get_doc("File", f.name).get_full_path()).read_bytes()
			frappe.get_doc(
				{
					"doctype": "File",
					"file_name": name,
					"attached_to_doctype": JOURNAL_ENTRY,
					"attached_to_name": journal_entry,
					"is_private": 1,
					"content": excel_lock.lock(content, password),
				}
			).insert()
			attached.add(name)
		locked.append(name)
	return {
		"originals": [f.file_name for f in excel],
		"locked": locked,
		"not_locked": not_locked,
	}

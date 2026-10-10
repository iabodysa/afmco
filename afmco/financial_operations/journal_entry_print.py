# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.translate import print_language
from frappe.utils import flt, get_fullname, in_words, money_in_words

from afmco.financial_operations.requisition_pack import (
	IMAGE_EXTENSIONS,
	JOURNAL_ENTRY,
	PAYMENT_REQUISITION,
	file_extension,
	pack_file_name,
	requisition_files,
)

DOSSIER_MARK = "-dossier-"
SUBMIT_CHANGE = '%["docstatus",0,1]%'


def journal_entry_trail(doc):
	return frappe._dict(
		prepared=frappe._dict(user=get_fullname(doc.owner), at=doc.creation),
		approved=approval(doc),
		attachments=attachments(doc),
	)


def approval(doc):
	if not doc.name or doc.docstatus == 0:
		return None
	versions = frappe.get_all(
		"Version",
		filters={
			"ref_doctype": doc.doctype,
			"docname": doc.name,
			"data": ["like", SUBMIT_CHANGE],
		},
		fields=["owner", "creation"],
		order_by="creation desc",
		limit=1,
	)
	if not versions:
		return None
	return frappe._dict(user=get_fullname(versions[0].owner), at=versions[0].creation)


def attachments(doc):
	files = [
		f
		for f in frappe.get_all(
			"File",
			filters={
				"attached_to_doctype": JOURNAL_ENTRY,
				"attached_to_name": doc.name,
				"is_folder": 0,
			},
			fields=["name", "file_name", "file_url", "file_size"],
			order_by="creation asc",
		)
		if not is_dossier(f)
	]
	rows = [attachment_row(f, JOURNAL_ENTRY) for f in files]
	requisition = doc.get("expense_request_cf")
	if requisition and pack_file_name(requisition) not in {f.file_name for f in files}:
		rows += [attachment_row(f, PAYMENT_REQUISITION) for f in requisition_files(requisition)]
	return rows


def is_dossier(file):
	name = file.file_name or ""
	return DOSSIER_MARK in name and name.lower().endswith(".pdf")


def attachment_row(file, source):
	extension = file_extension(file)
	remote = (file.file_url or "").startswith(("http://", "https://"))
	return frappe._dict(
		file_name=file.file_name or file.file_url,
		source=source,
		included=not remote and (extension == "pdf" or extension in IMAGE_EXTENSIONS),
	)


def money_words(amount, currency):
	amount = abs(flt(amount, 2))
	with print_language("ar"):
		arabic = arabic_words(amount, currency)
	with print_language("en"):
		english = money_in_words(amount, currency)
	return frappe._dict(ar=arabic, en=english)


def arabic_words(amount, currency):
	units = (
		frappe.db.get_value(
			"Currency",
			currency,
			["currency_name", "fraction", "fraction_units"],
			as_dict=True,
		)
		or frappe._dict()
	)
	whole = int(amount)
	fraction = round((amount - whole) * (units.fraction_units or 100))
	words = f"{in_words(whole)} {_(units.currency_name or currency)}" if whole or not fraction else ""
	if fraction:
		joint = f"{words} {_('and')} " if words else ""
		words = f"{joint}{in_words(fraction)} {_(units.fraction or '')}"
	return _("Only {0} and nothing more").format(words)

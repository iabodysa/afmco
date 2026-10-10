# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.translate import print_language
from frappe.utils import flt, get_fullname, in_words, money_in_words

from afmco.financial_operations.journal_entry_dossier import dossier_file_name, print_format, split
from afmco.financial_operations.requisition_pack import (
	IMAGE_EXTENSIONS,
	JOURNAL_ENTRY,
	PAYMENT_REQUISITION,
	file_extension,
)

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
	return [attachment_row(f, JOURNAL_ENTRY) for f in split(doc.name)[0]]


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


def attach_to_requisition(journal_entry: str) -> None:
	requisition = frappe.db.get_value(JOURNAL_ENTRY, journal_entry, "expense_request_cf")
	if not requisition:
		return
	file_name = dossier_file_name(journal_entry)
	content = frappe.get_print(JOURNAL_ENTRY, journal_entry, print_format(), as_pdf=True)
	for previous in frappe.get_all(
		"File",
		filters={
			"attached_to_doctype": PAYMENT_REQUISITION,
			"attached_to_name": requisition,
			"file_name": file_name,
		},
		pluck="name",
	):
		frappe.delete_doc("File", previous)
	frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": PAYMENT_REQUISITION,
			"attached_to_name": requisition,
			"is_private": 1,
			"content": content,
		}
	).insert()

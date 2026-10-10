# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import hashlib
from datetime import date

import frappe
from frappe import _
from frappe.model.workflow import get_transitions, get_workflow_name
from frappe.utils import cstr, now

from afmco.approver_check.registry import APPROVER_STATES

VERSION = 1
LIMIT_BYTES = 64 * 1024
READ = "read"
FAILED = "failed"
READING = "reading"
FINDING = "finding"
CLEAN = "clean"
READ_FLAG = "accounts_bot_read_cf"
EVENT = "afmco_attachment_reading"
STATUSES = (READ, "partial", FAILED)
DOC_TYPES = ("bank_receipt", "invoice", "tax_invoice", "quotation", "salary_sheet", "bank_statement", "id_document", "letter", "other")
CONFIDENCE = ("high", "medium", "low")
CODES = ("amount_mismatch", "iban_mismatch", "name_mismatch", "date_mismatch", "tamper", "unreadable", "missing_document", "id_mismatch")
TOP_KEYS = {"v", "status", "files", "findings"}
FILE_KEYS = {"file", "file_name", "readable", "doc_type", "amount", "currency", "iban", "name", "date", "reference", "vat_number", "tamper_signs", "confidence"}
FINDING_KEYS = {"code", "field", "form_value", "file_value", "file", "label", "detail"}
LABEL_CHARS = 40
DETAIL_CHARS = 200


def text(value, limit: int | None = None, nullable: bool = False) -> bool:
	if value is None:
		return nullable
	return isinstance(value, str) and (limit is None or len(value) <= limit)


def iso_date(value) -> bool:
	if value is None:
		return True
	try:
		return isinstance(value, str) and date.fromisoformat(value).isoformat() == value
	except ValueError:
		return False


def file_problem(file) -> str | None:
	if not isinstance(file, dict) or set(file) != FILE_KEYS:
		return "keys"
	amount = file["amount"]
	valid = {
		"file": text(file["file"]) and bool(file["file"]),
		"file_name": text(file["file_name"]),
		"readable": isinstance(file["readable"], bool),
		"doc_type": file["doc_type"] in DOC_TYPES,
		"amount": amount is None or (isinstance(amount, int | float) and not isinstance(amount, bool)),
		"currency": text(file["currency"]),
		"iban": text(file["iban"], nullable=True),
		"name": text(file["name"], nullable=True),
		"date": iso_date(file["date"]),
		"reference": text(file["reference"], nullable=True),
		"vat_number": text(file["vat_number"], nullable=True),
		"tamper_signs": isinstance(file["tamper_signs"], list) and all(text(sign) for sign in file["tamper_signs"]),
		"confidence": file["confidence"] in CONFIDENCE,
	}
	return next((key for key, ok in valid.items() if not ok), None)


def finding_problem(finding) -> str | None:
	if not isinstance(finding, dict) or set(finding) != FINDING_KEYS:
		return "keys"
	valid = {
		"code": finding["code"] in CODES,
		"field": text(finding["field"]),
		"form_value": text(finding["form_value"]),
		"file_value": text(finding["file_value"]),
		"file": text(finding["file"]),
		"label": text(finding["label"], LABEL_CHARS) and bool(finding["label"]),
		"detail": text(finding["detail"], DETAIL_CHARS),
	}
	return next((key for key, ok in valid.items() if not ok), None)


def refuse(part: str) -> None:
	frappe.throw(_("The reading does not match reading shape version 1 at {0}.").format(part))


def parse(reading) -> dict:
	if isinstance(reading, str) and len(reading.encode()) > LIMIT_BYTES:
		refuse("size")
	reading = frappe.parse_json(reading)
	if not isinstance(reading, dict) or set(reading) != TOP_KEYS:
		refuse("keys")
	if len(frappe.as_json(reading).encode()) > LIMIT_BYTES:
		refuse("size")
	if reading["v"] != VERSION or isinstance(reading["v"], bool):
		refuse("v")
	if reading["status"] not in STATUSES:
		refuse("status")
	for part in ("files", "findings"):
		if not isinstance(reading[part], list):
			refuse(part)
	for index, file in enumerate(reading["files"]):
		problem = file_problem(file)
		if problem:
			refuse(f"files[{index}].{problem}")
	for index, finding in enumerate(reading["findings"]):
		problem = finding_problem(finding)
		if problem:
			refuse(f"findings[{index}].{problem}")
	return dict(reading)


def current_files(doctype: str, name: str) -> list[dict]:
	return frappe.get_all(
		"File",
		filters={"attached_to_doctype": doctype, "attached_to_name": name, "is_folder": 0},
		fields=["name", "content_hash"],
	)


def files_hash(files: list[dict]) -> str:
	listed = sorted(f"{file.name}:{cstr(file.content_hash)}" for file in files)
	return hashlib.sha256("\n".join(listed).encode()).hexdigest()


def read_hash(doc, reading: dict) -> str:
	attached = {file.name: file for file in current_files(doc.doctype, doc.name)}
	named = {file["file"] for file in reading["files"]}
	unknown = sorted(named - set(attached))
	if unknown:
		frappe.throw(_("{0} is not attached to {1}.").format(", ".join(unknown), doc.name))
	return files_hash([attached[name] for name in named])


def stored(doc) -> dict | None:
	return frappe.parse_json(doc.ai_reading_cf) if doc.get("ai_reading_cf") else None


def stale(doc) -> bool:
	return doc.ai_reading_files_hash != files_hash(current_files(doc.doctype, doc.name))


def fresh(doc) -> dict | None:
	reading = stored(doc)
	return reading if reading and not stale(doc) else None


def save(doc, reading) -> None:
	reading = parse(reading)
	values = {
		"ai_reading_cf": frappe.as_json(reading),
		"ai_reading_at": now(),
		"ai_reading_files_hash": read_hash(doc, reading),
		READ_FLAG: 0,
	}
	doc.db_set(values, update_modified=False)
	frappe.publish_realtime(EVENT, {"doctype": doc.doctype, "name": doc.name}, doctype=doc.doctype, docname=doc.name, after_commit=True)


def request(doc) -> None:
	doc.db_set(READ_FLAG, 1, update_modified=False, notify=True)


def approver_allowed(doc) -> bool:
	if doc.doctype not in APPROVER_STATES or doc.is_new():
		return False
	if doc.get("workflow_state") not in APPROVER_STATES[doc.doctype]:
		return False
	if not get_workflow_name(doc.doctype) or not doc.has_permission("read"):
		return False
	return bool(get_transitions(doc))


def needs_reading(doc) -> bool:
	current = state(doc)
	return current is None or current["status"] == FAILED


def state(doc) -> dict | None:
	if doc.get(READ_FLAG):
		return {"status": READING, "at": None, "findings": []}
	reading = fresh(doc)
	if reading is None:
		return None
	findings = [{"label": finding["label"], "detail": finding["detail"]} for finding in reading["findings"]]
	if reading["status"] == FAILED or (reading["status"] != READ and not findings):
		status = FAILED
	else:
		status = FINDING if findings else CLEAN
	return {"status": status, "at": doc.ai_reading_at, "findings": findings}


def set_onload(doc) -> None:
	allowed = approver_allowed(doc)
	doc.set_onload("attachment_check", {"state": state(doc)} if allowed else None)

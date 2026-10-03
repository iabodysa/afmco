# Copyright (c) 2026, AFMCO and contributors

import frappe
from frappe.model.document import Document
from frappe.utils import cint

SETTINGS = "Action Inbox Settings"

DOCUMENT_TYPES = (
	(
		"End of Service Settlement",
		("Pending", "Waiting Accountant Approval", "Waiting Manager Approval", "Legal", "Document Upload", "Approved"),
		("Cancelled", "Paid"),
	),
	(
		"Payment Requisition",
		(
			"Pending",
			"Financial Controller",
			"Waiting P.M Approval",
			"Waiting Manager Approval",
			"Waiting Bank Entry",
			"First Approval for Bank",
			"Document Upload",
			"Waiting",
		),
		("Rejected", "Paid", "Cancelled"),
	),
	("IBAN Update", ("Pending",), ("Approved", "Rejected", "Cancelled")),
	("Overtime Assignment Request", ("Pending", "Approved", "Document Upload"), ("Cancelled", "Paid", "Rejected")),
	(
		"Petty Cash",
		("Pending", "Waiting Accountant Approval", "Document Upload", "Waiting for liquidation"),
		("Rejected", "Paid"),
	),
	(
		"Vacation Allowance",
		("Pending", "Waiting Accountant Approval", "Waiting Manager Approval", "Approved"),
		("Rejected", "Cancelled", "Paid"),
	),
)


class ActionInboxSettings(Document):
	pass


def get_int(field: str) -> int:
	return cint(frappe.db.get_single_value(SETTINGS, field)) or cint(
		frappe.get_meta(SETTINGS).get_field(field).default
	)


def seed_document_types():
	settings = frappe.get_single(SETTINGS)
	if settings.document_types:
		return
	for document_type, active, terminal in DOCUMENT_TYPES:
		settings.append(
			"document_types",
			{
				"document_type": document_type,
				"active_states": "\n".join(active),
				"terminal_states": "\n".join(terminal),
			},
		)
	settings.save()

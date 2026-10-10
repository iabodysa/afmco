# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _

from afmco.financial_operations import journal_entry_dossier, requisition_pack
from afmco.financial_operations.requisition_pack import JOURNAL_ENTRY


@frappe.whitelist(methods=["POST"])
def build_dossier(journal_entry: str) -> dict:
	frappe.only_for(journal_entry_dossier.ROLES, message=True)
	entry = frappe.get_doc(JOURNAL_ENTRY, journal_entry)
	entry.check_permission("read")
	if entry.docstatus == 0:
		frappe.throw(_("Journal Entry {0} must be submitted before printing with attachments.").format(journal_entry))
	files = journal_entry_dossier.inputs(entry)
	if requisition_pack.input_size(files) > requisition_pack.BACKGROUND_THRESHOLD and not frappe.db.exists(
		"File",
		{
			"attached_to_doctype": JOURNAL_ENTRY,
			"attached_to_name": journal_entry,
			"file_name": journal_entry_dossier.dossier_file_name(entry, files),
		},
	):
		frappe.enqueue(
			journal_entry_dossier.build,
			queue="long",
			job_id=f"je-dossier::{journal_entry}",
			deduplicate=True,
			journal_entry=journal_entry,
		)
		return {"queued": True}
	return journal_entry_dossier.build(journal_entry)

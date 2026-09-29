import json
import os

import frappe
from frappe.modules.utils import sync_customizations_for_doctype

from afmco.people_and_payroll.doctype.action_inbox_settings.action_inbox_settings import seed_document_types

LINK_TARGET_CUSTOMIZATIONS = {
	"additional_salary.json": "people_and_payroll",
	"journal_entry.json": "financial_operations",
	"payment_entry.json": "financial_operations",
}


def after_install():
	for filename, module in LINK_TARGET_CUSTOMIZATIONS.items():
		folder = frappe.get_app_path("afmco", module, "custom")
		with open(os.path.join(folder, filename)) as f:
			sync_customizations_for_doctype(json.load(f), folder, filename)
	seed_document_types()

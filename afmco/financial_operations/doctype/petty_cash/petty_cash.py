# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days


class PettyCash(Document):
	def validate(self):
		if self.issue_date and self.has_value_changed("issue_date"):
			self.due_date = add_days(self.issue_date, 30)
		self.validate_declaration_attached()

	def validate_declaration_attached(self):
		previous = self.get_doc_before_save()
		if (
			previous
			and previous.workflow_state == "Pending"
			and self.workflow_state != "Pending"
			and not self.attach_the_declaration
		):
			frappe.throw(_("Attach the signed declaration before moving the request out of Pending."))

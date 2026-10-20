# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import getdate


class ClientTimesheet(Document):
	def validate(self):
		if getdate(self.from_date) > getdate(self.to_date):
			frappe.throw(_("From Date must be on or before To Date."))

	def on_update(self):
		if self.has_value_changed("bot_status") or self.has_value_changed("bot_note"):
			frappe.publish_realtime(
				"payroll_bot_status",
				{"name": self.name, "status": self.bot_status, "note": self.bot_note},
				doctype=self.doctype,
				docname=self.name,
				after_commit=True,
			)

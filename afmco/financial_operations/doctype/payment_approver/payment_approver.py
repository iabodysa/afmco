# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document


class PaymentApprover(Document):
	def validate(self):
		self.permission_role = f"{self.name1 or ''} - {self.department or ''}"
		holder = frappe.db.exists(
			"Payment Approver", {"permission_role": self.permission_role, "name": ("!=", self.name)}
		)
		if holder:
			frappe.throw(
				_("Permission Role {0} is already held by Payment Approver {1}").format(
					frappe.bold(self.permission_role), frappe.bold(holder)
				),
				frappe.UniqueValidationError,
			)

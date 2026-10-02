# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.permissions import add_user_permission

RESTRICTED_DOCTYPE = "Payment Requisition"


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

	def on_update(self):
		if self.user:
			self.update_user_permission()

	def update_user_permission(self):
		if not any(self.has_value_changed(f) for f in ("user", "create_user_permission", "active")):
			return

		if not self.create_user_permission:
			granted = frappe.db.exists(
				"User Permission",
				{
					"allow": self.doctype,
					"for_value": self.name,
					"user": self.user,
					"applicable_for": RESTRICTED_DOCTYPE,
				},
			)
			if granted:
				frappe.delete_doc("User Permission", granted, force=True, ignore_permissions=True)
		elif self.active:
			grant_user_permission(self.name, self.user)


def grant_user_permission(approver, user):
	if frappe.db.exists("User Permission", {"allow": "Payment Approver", "for_value": approver, "user": user}):
		return
	add_user_permission(
		"Payment Approver", approver, user, ignore_permissions=True, applicable_for=RESTRICTED_DOCTYPE
	)


def restore_user_permissions():
	for approver in frappe.get_all(
		"Payment Approver",
		filters={"active": 1, "create_user_permission": 1, "user": ("is", "set")},
		fields=["name", "user"],
	):
		grant_user_permission(approver.name, approver.user)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext.setup.doctype.employee.employee import InactiveEmployeeStatusError
from frappe import _
from frappe.utils import get_link_to_form

HOLD_STATUS = "Hold"
ON_LEAVE_STATUS = "On Leave"
CORE_STAND_IN_STATUS = {HOLD_STATUS: "Inactive", ON_LEAVE_STATUS: "Active"}


class AfmcoEmployee:
	def validate(self):
		self.run_with_core_status(super().validate)

	def update_user_status(self):
		self.run_with_core_status(super().update_user_status)

	def run_with_core_status(self, method):
		status = self.status
		self.status = CORE_STAND_IN_STATUS.get(status, status)
		try:
			method()
		finally:
			self.status = status


def employees_on_hold(names) -> set[str]:
	names = list(names)
	if not names:
		return set()
	return set(frappe.get_all("Employee", filters={"name": ["in", names], "status": HOLD_STATUS}, pluck="name"))


def validate_not_on_hold(employee: str | None) -> None:
	if employee and frappe.db.get_value("Employee", employee, "status") == HOLD_STATUS:
		frappe.throw(
			_("Transactions cannot be created for an Employee on Hold {0}.").format(
				get_link_to_form("Employee", employee)
			),
			InactiveEmployeeStatusError,
		)

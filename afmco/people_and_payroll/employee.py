# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext.setup.doctype.employee.employee import InactiveEmployeeStatusError
from frappe import _
from frappe.utils import get_link_to_form

HOLD_STATUS = "Hold"
ON_LEAVE_STATUS = "On Leave"
CORE_STAND_IN_STATUS = "Inactive"
AFMCO_STATUSES = frozenset({HOLD_STATUS, ON_LEAVE_STATUS})


class AfmcoEmployee:
	def validate(self):
		if self.status not in AFMCO_STATUSES:
			return super().validate()
		status = self.status
		self.status = CORE_STAND_IN_STATUS
		try:
			super().validate()
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

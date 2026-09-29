# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cstr, flt, today

EMPLOYEE_SYNC_FIELDS = (
	("Joining Date", "date_of_joining", "joining_date"),
	("Bank Account Number", "bank_ac_no", "bank_account_number"),
	("Branch", "branch", "project"),
	("Basic Wage", "basic_wage", "basic_salary"),
	("Ticket Allowance", "ticket_allowance", "ticket_allowance"),
	("Mobile", "cell_number", "cell_number"),
	("Email", "personal_email", "personal_email"),
)
LOG_FIELDS = (
	"employee",
	"joining_date",
	"bank_account_number",
	"project",
	"basic_salary",
	"ticket_allowance",
	"cell_number",
	"personal_email",
)


def comparable(value):
	return flt(value) if isinstance(value, int | float) else cstr(value)


class EmployeeUpdate(Document):
	@frappe.whitelist()
	def sync_to_employee(self):
		if not self.employee:
			frappe.throw(_("Please select an employee first."))
		employee = frappe.get_doc("Employee", self.employee)
		note = "".join(
			f"{label}: {employee.get(target)} -> {self.get(source)}\n"
			for label, target, source in EMPLOYEE_SYNC_FIELDS
			if comparable(employee.get(target)) != comparable(self.get(source))
		)
		if note:
			log = {field: self.get(field) for field in LOG_FIELDS}
			log.update({"modification_date": today(), "modified_by1": frappe.session.user, "note": note})
			self.append("log", log)
			self.save()
		employee.update({target: self.get(source) for _label, target, source in EMPLOYEE_SYNC_FIELDS})
		employee.save()
		frappe.msgprint(_("Employee updated successfully."))

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import math

import frappe
from frappe import _
from frappe.utils import flt
from hrms.payroll.doctype.salary_slip.salary_slip_loan_utils import set_loan_repayment

from afmco.people_and_payroll.doctype.temporary_iban.temporary_iban import get_active_temporary_ibans
from afmco.people_and_payroll.employee import HOLD_STATUS, validate_not_on_hold

LOAN_REPAYMENT_COMPONENT = "Loan Repayment"
ACTIVE_STATUS = "Active"
RETURN_TO_ACTIVE_SAVEPOINT = "afmco_return_to_active"


class AfmcoSalarySlip:
	def validate(self):
		super().validate()
		if not self.is_payroll_entry_employee():
			validate_not_on_hold(self.employee)
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.validate_single_loan_deduction()
		if self.docstatus == 0:
			self.pull_emp_details()
		total = (self.basic33 or 0) + (self.housing33 or 0)
		if self.net_pay > total:
			self.other_allowance33 = self.net_pay - total
		else:
			self.other_allowance33 = 0
		if self.net_pay < total:
			self.deduction33 = total - self.net_pay
		else:
			self.deduction33 = 0
		start_date = frappe.utils.getdate(self.start_date)
		month = frappe.utils.formatdate(start_date, "MMMM")
		year = frappe.utils.formatdate(start_date, "YY")
		self.remark = f"Salary {month} {year}" + "-" + self.employee + "-" + self.employee_name
		for row in self.earnings + self.deductions:
			row.account = frappe.db.get_value(
				"Salary Component Account",
				{"parent": row.salary_component, "company": self.company},
				"account",
				cache=True,
			)

	def is_payroll_entry_employee(self):
		return bool(
			self.payroll_entry
			and frappe.db.exists(
				"Payroll Employee Detail",
				{"parenttype": "Payroll Entry", "parent": self.payroll_entry, "employee": self.employee},
			)
		)

	@frappe.whitelist()
	def get_emp_and_working_day_details(self):
		super().get_emp_and_working_day_details()
		if self.get("loans"):
			self.set("loans", [])
			set_loan_repayment(self)
			self.set_net_pay()

	def set_net_pay(self):
		self.cap_loan_repayment()
		super().set_net_pay()

	def cap_loan_repayment(self):
		rows = [row for row in self.get("loans", []) if flt(row.total_payment) > 0]
		if not rows:
			return
		scale = 10 ** self.precision("total_loan_repayment")
		cap = math.floor(flt(flt(self.gross_pay) / 3 * scale, 6)) / scale
		excess = flt(sum(flt(row.total_payment) for row in rows) - cap, 6)
		if excess <= 0:
			return
		posting_dates = dict(
			frappe.get_all(
				"Loan",
				filters={"name": ("in", [row.loan for row in rows])},
				fields=["name", "posting_date"],
				as_list=True,
			)
		)
		for row in sorted(rows, key=lambda row: (str(posting_dates.get(row.loan) or ""), row.loan)):
			cut = min(flt(row.total_payment), excess)
			row.total_payment = flt(flt(row.total_payment) - cut, row.precision("total_payment"))
			row.interest_amount = min(flt(row.interest_amount), row.total_payment)
			row.principal_amount = flt(
				row.total_payment - row.interest_amount, row.precision("principal_amount")
			)
			excess = flt(excess - cut, 6)
			if excess <= 0:
				break
		self.total_loan_repayment = sum(flt(row.total_payment) for row in self.loans)
		self.total_interest_amount = sum(flt(row.interest_amount) for row in self.loans)
		self.total_principal_amount = sum(flt(row.principal_amount) for row in self.loans)

	def validate_single_loan_deduction(self):
		if not any(flt(row.total_payment) for row in self.get("loans", [])):
			return
		if any(row.salary_component == LOAN_REPAYMENT_COMPONENT for row in self.deductions):
			frappe.throw(
				_("Employee {0} has a loan installment and a Loan Repayment deduction this period").format(
					self.employee
				)
			)

	def pull_emp_details(self):
		super().pull_emp_details()
		temporary_iban = get_active_temporary_ibans([self.employee], self.end_date).get(self.employee)
		self.temporary_iban = temporary_iban.name if temporary_iban else None
		if temporary_iban:
			self.iban_holder_name = temporary_iban.iban_holder_name
			self.bank_account_no = temporary_iban.iban
			self.bank_name = temporary_iban.bank_name
		else:
			self.iban_holder_name = frappe.get_cached_value("Employee", self.employee, "iban_holder_name")

	def on_submit(self):
		super().on_submit()
		self.return_held_employee_to_active()
		if not (self.temporary_iban and self.payroll_entry):
			return
		temporary_iban = frappe.get_doc("Temporary IBAN", self.temporary_iban)
		if self.payroll_entry in {row.payroll_entry for row in temporary_iban.wps_used}:
			return
		temporary_iban.append("wps_used", {"payroll_entry": self.payroll_entry})
		temporary_iban.save(ignore_permissions=True)

	def return_held_employee_to_active(self):
		if frappe.db.get_value("Employee", self.employee, "status") != HOLD_STATUS:
			return
		frappe.db.savepoint(RETURN_TO_ACTIVE_SAVEPOINT)
		try:
			employee = frappe.get_doc("Employee", self.employee)
			employee.status = ACTIVE_STATUS
			employee.flags.ignore_mandatory = True
			employee.flags.ignore_permissions = True
			employee.save()
			employee.add_comment(
				"Comment",
				f"Status returned to {ACTIVE_STATUS} by submitted Salary Slip {self.name}"
				f" of Payroll Entry {self.payroll_entry} by {frappe.session.user}.",
			)
		except Exception:
			frappe.db.rollback(save_point=RETURN_TO_ACTIVE_SAVEPOINT)
			frappe.log_error(
				title=f"Employee {self.employee} stays on {HOLD_STATUS} after Salary Slip {self.name}",
				reference_doctype="Salary Slip",
				reference_name=self.name,
			)

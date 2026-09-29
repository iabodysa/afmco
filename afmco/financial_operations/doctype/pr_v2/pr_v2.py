# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document
from frappe.utils import flt

PAYMENT_TYPE_ACCOUNTS = {
	"Employee Loan": "124001 - سلف الموظفين - AF",
	"EOS": "212004 - مخصص مكافاة نهاية خدمة - AF",
	"Vacation Allowance": "212002 - مخصص رواتب اجازة سنوية - AF",
	"Payroll (Salary)": "214001 - الرواتب المستحقة - AF",
}

PAYMENT_TYPE_DEFAULTS = {
	"Vacation Allowance": {"type": "Accrued Expenses", "mode_of_payment": "Bank Transfer"},
	"SADAD Payment": {"mode_of_payment": "SADAD Payment"},
	"EOS": {"type": "Accrued Expenses", "mode_of_payment": "Bank Transfer"},
	"Payroll (Salary)": {"type": "Accrued Expenses", "mode_of_payment": "Bank Transfer"},
	"Employee Loan": {"type": "Expenses", "mode_of_payment": "Bank Transfer"},
}


class PRv2(Document):
	def validate(self):
		if (self.payment_type or not self.is_new()) and self.has_value_changed("payment_type"):
			self.update(PAYMENT_TYPE_DEFAULTS.get(self.payment_type, {"type": "Expenses"}))
		self.amount = sum(flt(row.amount) for row in self.group)
		if self.payment_type in PAYMENT_TYPE_ACCOUNTS:
			self.account = PAYMENT_TYPE_ACCOUNTS[self.payment_type]

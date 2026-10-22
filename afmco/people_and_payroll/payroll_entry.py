# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext.accounts.doctype.journal_entry.journal_entry import get_account_details_and_party_type
from frappe import _
from frappe.utils import flt, getdate

from afmco.people_and_payroll.employee import employees_on_hold
from afmco.people_and_payroll.payroll_check import held_employee_rows, payroll_check


class AfmcoPayrollEntry:
	@frappe.whitelist()
	def get_payroll_check(self):
		self.check_permission("read")
		return payroll_check(self)

	@frappe.whitelist()
	def include_held_employees(self, employees):
		self.check_permission("write")
		if self.docstatus != 0:
			frappe.throw(_("Employees can be added only while the payroll is a draft"))
		employees = set(frappe.parse_json(employees))
		rows = [row for row in held_employee_rows(self) if row.employee in employees]
		refused = employees - {row.employee for row in rows}
		if refused:
			frappe.throw(
				_("Only employees on Hold that this payroll would pay can be included: {0}").format(
					", ".join(sorted(refused))
				)
			)
		for row in rows:
			self.append("employees", row)
		self.number_of_employees = len(self.employees)
		self.update_employees_with_withheld_salaries()

	def fill_employee_details(self):
		unmarked = super().fill_employee_details()
		held = employees_on_hold(row.employee for row in self.employees)
		if not held:
			return unmarked
		for row in [row for row in self.employees if row.employee in held]:
			self.remove(row)
		if not self.employees:
			frappe.throw(_("No employees found"))
		self.number_of_employees = len(self.employees)
		return self.get_employees_with_unmarked_attendance()


def submitted_salary_slips(payroll_entry, fields):
	return frappe.get_list(
		"Salary Slip",
		filters={"payroll_entry": payroll_entry, "docstatus": 1},
		fields=fields,
		limit_page_length=0,
	)


def readable_salary_slip(name):
	slip = frappe.get_doc("Salary Slip", name)
	slip.check_permission("read")
	return slip


def component_accounts(company):
	components = set(frappe.get_list("Salary Component", pluck="name", limit_page_length=0))
	accounts = {
		row.parent: row.account
		for row in frappe.get_list(
			"Salary Component Account",
			parent_doctype="Salary Component",
			filters={"company": company},
			fields=["parent", "account"],
			limit_page_length=0,
		)
	}
	return {component: accounts.get(component) for component in components}


def new_journal_entry(payroll_entry, voucher_type, user_remark):
	journal_entry = frappe.new_doc("Journal Entry")
	journal_entry.update(
		{
			"voucher_type": voucher_type,
			"posting_date": payroll_entry.posting_date,
			"company": payroll_entry.company,
			"payroll_entry": payroll_entry.name,
			"cheque_no": payroll_entry.name,
			"cheque_date": payroll_entry.posting_date,
			"user_remark": user_remark,
		}
	)
	return journal_entry


def append_account_row(journal_entry, row, party=None, employee=None):
	row = {
		"debit_in_account_currency": 0,
		"credit_in_account_currency": 0,
		**row,
	}
	row = {
		**(
			get_account_details_and_party_type(
				row["account"],
				journal_entry.posting_date,
				journal_entry.company,
				debit=flt(row["debit_in_account_currency"]),
				credit=flt(row["credit_in_account_currency"]),
			)
			or {}
		),
		**{key: value for key, value in row.items() if value is not None},
		"cost_center": row.get("cost_center") or "",
	}
	if party:
		row.update({"party_type": "Employee", "party": party})
	elif employee:
		row["employee"] = employee
	child = journal_entry.append("accounts", row)
	child.debit = flt(flt(child.debit_in_account_currency) * flt(child.exchange_rate), child.precision("debit"))
	child.credit = flt(
		flt(child.credit_in_account_currency) * flt(child.exchange_rate), child.precision("credit")
	)


def clearing_account(payroll_entry):
	if payroll_entry.payroll_clearing_account:
		return payroll_entry.payroll_clearing_account
	default = payroll_entry.meta.get_field("payroll_clearing_account").default
	if default and frappe.db.get_value("Account", default, "company") == payroll_entry.company:
		return default


def refuse_if_missing(payroll_entry, missing):
	if missing:
		frappe.throw(
			list(dict.fromkeys(missing)),
			title=_("Set these for {0} before creating the Journal Entry").format(payroll_entry.company),
			as_list=True,
		)


def build_accrual_entry(payroll_entry):
	accounts = component_accounts(payroll_entry.company)
	slips = [
		readable_salary_slip(slip.name)
		for slip in submitted_salary_slips(payroll_entry.name, ["name", "employee", "net_pay"])
	]
	if not slips:
		frappe.throw(_("No Salary Slips found."))

	clearing = clearing_account(payroll_entry)
	missing = []
	if not payroll_entry.payroll_payable_account:
		missing.append(_("Please set the Payroll Payable Account."))
	if not clearing:
		missing.append(_("Please set the Payroll Clearing Account."))
	for slip in slips:
		if not (slip.cost_center or payroll_entry.cost_center):
			missing.append(
				_(
					"Cost Center is missing for Salary Slip {0} and no default Cost Center in Payroll Entry document."
				).format(slip.name)
			)
		missing.extend(
			_('Default account not found for Salary Component: "{0}".').format(row.salary_component)
			for row in slip.earnings
			if not accounts.get(row.salary_component)
		)
		missing.extend(
			_('Default account not found for Deduction Component: "{0}".').format(row.salary_component)
			for row in slip.deductions
			if not accounts.get(row.salary_component)
		)
	refuse_if_missing(payroll_entry, missing)

	start_date = getdate(payroll_entry.start_date)
	journal_entry = new_journal_entry(
		payroll_entry,
		"Payroll Entry",
		f"Salary accrual for {start_date.strftime('%B')} {start_date.year}\n"
		f"From: {payroll_entry.start_date} to: {payroll_entry.end_date}",
	)

	for slip in slips:
		cost_center = slip.cost_center or payroll_entry.cost_center
		remark = slip.remark or ""
		for earning in slip.earnings:
			append_account_row(
				journal_entry,
				{
					"account": accounts[earning.salary_component],
					"debit_in_account_currency": earning.amount or 0,
					"cost_center": cost_center,
					"user_remark": remark,
				},
				employee=slip.employee,
			)
		for deduction in slip.deductions:
			append_account_row(
				journal_entry,
				{
					"account": accounts[deduction.salary_component],
					"credit_in_account_currency": deduction.amount or 0,
					"user_remark": remark,
				},
				party=slip.employee,
			)
		if slip.total_loan_repayment:
			append_account_row(
				journal_entry,
				{
					"account": payroll_entry.payroll_payable_account,
					"credit_in_account_currency": slip.total_loan_repayment,
					"user_remark": remark,
				},
				party=slip.employee,
			)
		if (slip.net_pay or 0) > 0:
			append_account_row(
				journal_entry,
				{
					"account": clearing,
					"credit_in_account_currency": slip.net_pay,
					"user_remark": remark,
				},
				party=slip.employee,
			)

	journal_entry.set_total_debit_credit()
	return journal_entry


TRANSFER_FEES = {("AF", "122001"): ("10", 3.5), ("AF", "122003"): ("65", 7)}
BANK_FEES_ACCOUNT_NUMBER = "520006"
VAT_ACCOUNT_NUMBER = "216003"


def iban_bank_code(iban):
	return (iban or "").replace(" ", "").upper()[4:6]


def bank_fee_defaults(payroll_entry):
	company = payroll_entry.company
	abbr = frappe.get_cached_value("Company", company, "abbr")
	account_number = payroll_entry.payment_account and frappe.get_cached_value(
		"Account", payroll_entry.payment_account, "account_number"
	)
	payer_bank, fees_per_transfer = TRANSFER_FEES.get((abbr, account_number), (None, 0))
	paid = [
		slip.employee
		for slip in submitted_salary_slips(payroll_entry.name, ["employee", "net_pay"])
		if (slip.net_pay or 0) > 0
	]
	ibans = dict(
		frappe.get_all("Employee", filters={"name": ["in", paid]}, fields=["name", "bank_ac_no"], as_list=True)
	)
	transfers = sum(1 for employee in paid if iban_bank_code(ibans.get(employee)) != payer_bank)
	return {
		"apply_fees": int(bool(fees_per_transfer and transfers)),
		"fees_per_transfer": fees_per_transfer,
		"employee_count": transfers,
		"bank_fees_account": frappe.db.get_value(
			"Account", {"company": company, "account_number": BANK_FEES_ACCOUNT_NUMBER, "is_group": 0}
		),
		"vat_account": frappe.db.get_value(
			"Account", {"company": company, "account_number": VAT_ACCOUNT_NUMBER, "is_group": 0}
		),
	}


def build_bank_entry(payroll_entry, fees):
	journal_entry = new_journal_entry(
		payroll_entry,
		"Bank Entry",
		f"Salary payment from {payroll_entry.start_date} to {payroll_entry.end_date}",
	)

	slips = submitted_salary_slips(
		payroll_entry.name, ["name", "employee", "employee_name", "net_pay", "cost_center", "remark"]
	)
	if not slips:
		frappe.throw(_("No Salary Slips found for payment."))

	clearing = clearing_account(payroll_entry)
	missing = []
	if not payroll_entry.payroll_payable_account:
		missing.append(_("Please set the Payroll Payable Account."))
	if not clearing:
		missing.append(_("Please set the Payroll Clearing Account."))
	if not payroll_entry.payment_account:
		missing.append(_("Please set the Payment Account."))
	if fees.get("apply_fees") and (not fees.get("bank_fees_account") or not fees.get("vat_account")):
		missing.append(_("Please select Bank Fees Account and VAT Account if applying fees."))
	missing.extend(
		_("Cost Center is missing for Salary Slip {0} or Payroll Entry default for Bank Entry.").format(
			slip.name
		)
		for slip in slips
		if (slip.net_pay or 0) > 0 and not (slip.cost_center or payroll_entry.cost_center)
	)
	refuse_if_missing(payroll_entry, missing)

	total_payment = 0
	for slip in slips:
		if (slip.net_pay or 0) > 0:
			append_account_row(
				journal_entry,
				{
					"account": clearing,
					"debit_in_account_currency": slip.net_pay,
					"cost_center": slip.cost_center or payroll_entry.cost_center,
					"user_remark": slip.remark or "",
				},
				party=slip.employee,
			)
			total_payment += slip.net_pay

	if total_payment > 0:
		append_account_row(
			journal_entry,
			{
				"account": payroll_entry.payment_account,
				"bank_account": payroll_entry.bank_account,
				"credit_in_account_currency": total_payment,
				"cost_center": payroll_entry.cost_center,
				"user_remark": f"{payroll_entry.cost_center} - {payroll_entry.month_name or ''}",
			},
		)
		if fees.get("apply_fees") and flt(fees.get("total_fees")) > 0:
			total_fees = fees.get("total_fees") or 0
			vat_amount = fees.get("vat_amount") or 0
			for row in (
				{
					"account": fees.get("bank_fees_account"),
					"debit_in_account_currency": total_fees,
					"cost_center": payroll_entry.cost_center
					or frappe.get_cached_value("Company", payroll_entry.company, "cost_center"),
					"user_remark": _("Bank transfer fees"),
				},
				{
					"account": fees.get("vat_account"),
					"debit_in_account_currency": vat_amount,
					"user_remark": _("VAT for bank transfer fees"),
				},
				{
					"account": payroll_entry.payment_account,
					"credit_in_account_currency": total_fees,
					"user_remark": _("Bank transfer fees"),
				},
				{
					"account": payroll_entry.payment_account,
					"credit_in_account_currency": vat_amount,
					"user_remark": _("VAT for bank transfer fees"),
				},
			):
				append_account_row(journal_entry, row)

	journal_entry.set_total_debit_credit()
	return journal_entry


def build_employee_wise_entry(payroll_entry, salary_slips):
	journal_entry = {
		"doctype": "Journal Entry",
		"voucher_type": "Payroll Entry",
		"payroll_entry": payroll_entry.name,
		"company": payroll_entry.company,
		"posting_date": payroll_entry.posting_date,
		"accounts": [],
	}
	rows = journal_entry["accounts"]
	total_credit = 0
	total_debit = 0

	for name in salary_slips:
		slip = readable_salary_slip(name)
		remark = slip.remark or "No remark"
		employee_credit = 0
		employee_debit = 0

		for earning in slip.earnings:
			if earning.get("account") and earning.amount:
				rows.append(
					{
						"account": earning.account,
						"debit_in_account_currency": earning.amount,
						"cost_center": slip.cost_center or payroll_entry.cost_center,
						"user_remark": remark,
						"employee": slip.employee,
					}
				)
				total_credit += earning.amount
				employee_credit += earning.amount

		for deduction in slip.deductions:
			if deduction.get("account") and deduction.amount:
				rows.append(
					{
						"account": deduction.account,
						"credit_in_account_currency": deduction.amount,
						"user_remark": remark,
						"party_type": "Employee",
						"party": slip.employee,
					}
				)
				total_debit += deduction.amount
				employee_debit += deduction.amount

		net_pay = employee_credit - employee_debit
		if net_pay:
			rows.append(
				{
					"account": payroll_entry.payroll_payable_account,
					"credit_in_account_currency" if net_pay > 0 else "debit_in_account_currency": abs(net_pay),
					"user_remark": remark,
					"party_type": "Employee",
					"party": slip.employee,
				}
			)
			if net_pay > 0:
				total_debit += net_pay
			else:
				total_credit += abs(net_pay)

	if total_credit != total_debit:
		frappe.msgprint(f"{_('Total Debit must equal Total Credit. The difference is')} {total_debit - total_credit}")
		return None

	return journal_entry

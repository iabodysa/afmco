# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import re

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt, getdate

PROJECT_ACCOUNTS = ("212004", "212002", "212001")
ADMINISTRATION_ACCOUNTS = ("531002", "531003", "531004")
SADAD_EXPENSE_ACCOUNTS = {
	"Issue or renew residence permit": ("532006", "512004"),
	"Transfer of sponsorship": ("532011", "512009"),
	"Change of profession": ("532005", "512005"),
	"Exit and Return Visa": ("532007", "512006"),
	"Extend exit and re-entry visa (1) month": ("532007", "512006"),
}
SADAD_PREPAID_ACCOUNTS = {"Transfer of sponsorship": "126006"}
SADAD_DEFAULT_PREPAID_ACCOUNT = "126004"
SADAD_BLOCK_SEPARATOR = "------------------------"
NUMBER = r"([\d,]+(?:\.\d+)?)"
EOS_TICKET = (rf"Ticket Allowance:\s*{NUMBER}",)
EOS_VACATION = (
	rf"Total Advance Leave Salary:\s*{NUMBER}",
	rf"Total Vacation Allowance:\s*{NUMBER}",
	rf"Vacation Allowance:\s*{NUMBER}",
)
EOS_AMOUNT = (rf"EOS:\s*{NUMBER}",)
LEAVE_TICKET = (rf"Total Ticket\|\s*{NUMBER}", rf"Ticket Allowance:\s*{NUMBER}")


def build(requisition: Document, bank_account: str, administration: bool) -> Document:
	eos_account, vacation_account, ticket_account = ADMINISTRATION_ACCOUNTS if administration else PROJECT_ACCOUNTS
	remark = requisition.remark or ""
	journal_entry = frappe.new_doc("Journal Entry")
	journal_entry.expense_request_cf = requisition.name
	journal_entry.user_remark = remark or f"Expense Request: {requisition.name}"
	names = account_names()
	precision = frappe.get_precision("Journal Entry Account", "debit_in_account_currency")
	amount = flt(requisition.amount, precision)

	def add_row(account_number, debit):
		debit = flt(debit, precision)
		if debit <= 0:
			return
		account = names.get(account_number)
		if not account:
			frappe.throw(_("Required account is missing: {0}").format(account_number))
		row = journal_entry.append("accounts", {"account": account, "debit_in_account_currency": debit})
		if administration and requisition.cost_center:
			row.cost_center = requisition.cost_center
		if administration and requisition.project:
			row.project = requisition.project

	if requisition.payment_type == "EOS":
		add_row(ticket_account, remark_amount(remark, EOS_TICKET))
		add_row(vacation_account, remark_amount(remark, EOS_VACATION))
		add_row(eos_account, flt(remark_amount(remark, EOS_AMOUNT), frappe.get_precision("End of Service Settlement", "total_eos")))
	elif requisition.payment_type == "Advance Leave Salary":
		ticket = flt(min(remark_amount(remark, LEAVE_TICKET), amount), precision)
		add_row(ticket_account, ticket)
		add_row(vacation_account, amount - ticket)
	elif requisition.payment_type == "SADAD Payment":
		add_sadad_rows(requisition, remark, administration, add_row)
	else:
		frappe.throw(
			_("Journal Entry creation is not configured for payment type: {0}").format(requisition.payment_type or "-")
		)

	if amount > 0:
		journal_entry.append("accounts", {"account": bank_account, "credit_in_account_currency": amount})
	return journal_entry


def add_sadad_rows(requisition: Document, remark: str, administration: bool, add_row) -> None:
	if not requisition.bank_payment_date:
		frappe.throw(_("Please verify the Bank Payment Date for year allocation."))
	parsed = 0
	for block in remark.split(SADAD_BLOCK_SEPARATOR):
		service = re.search(r"Type:\s*([^\n\r]+)", block, re.I)
		amount = re.search(rf"Amount:\s*{NUMBER}", block, re.I)
		if not service or not amount:
			continue
		service = service.group(1).strip()
		period = re.search(r"Period:\s*(\d+)", block, re.I)
		expense_accounts = SADAD_EXPENSE_ACCOUNTS.get(service)
		if not expense_accounts:
			frappe.throw(_("SADAD service type is not configured: {0}").format(service))
		current, future = split_by_year(
			flt(amount.group(1).replace(",", "")), requisition.bank_payment_date, int(period.group(1)) if period else 0
		)
		add_row(expense_accounts[0 if administration else 1], current)
		add_row(SADAD_PREPAID_ACCOUNTS.get(service, SADAD_DEFAULT_PREPAID_ACCOUNT), future)
		parsed += 1
	if not parsed:
		frappe.throw(_("No structured SADAD rows with Type and Amount were found in the remark."))


def split_by_year(amount: float, start_date, period_months: int) -> tuple[float, float]:
	if period_months <= 0:
		return flt(amount, 2), 0
	months_this_year = min(period_months, 13 - getdate(start_date).month)
	current = flt(amount * months_this_year / period_months, 2)
	return current, flt(amount - current, 2)


def remark_amount(remark: str, patterns: tuple[str, ...]) -> float:
	for pattern in patterns:
		if match := re.search(pattern, remark, re.I):
			return flt(match.group(1).replace(",", ""))
	return 0


def account_names() -> dict[str, str]:
	numbers = {
		*PROJECT_ACCOUNTS,
		*ADMINISTRATION_ACCOUNTS,
		*(number for pair in SADAD_EXPENSE_ACCOUNTS.values() for number in pair),
		*SADAD_PREPAID_ACCOUNTS.values(),
		SADAD_DEFAULT_PREPAID_ACCOUNT,
	}
	rows = frappe.get_all("Account", filters={"account_number": ["in", list(numbers)]}, fields=["name", "account_number"])
	return {row.account_number: row.name for row in rows}

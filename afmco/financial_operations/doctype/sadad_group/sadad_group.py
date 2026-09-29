# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from frappe.utils import cint, flt

SADAD_BILLER = "090"
SADAD_CHECKS = ("check1", "check2", "check3", "check4", "check5")
SADAD_TYPES = (
	"Issue or renew residence permit",
	"Transfer of sponsorship",
	"Change of profession",
	"Exit and Return Visa",
	"Extend exit and re-entry visa (1) month",
)
RESIDENCE_PERMIT_FEES = {3: 163, 6: 325, 9: 488, 12: 650}
SPONSORSHIP_TRANSFER_FEES = {1: 2000, 2: 4000, 3: 6000}
EXIT_AND_RETURN_FEES = {1: 200, 2: 200, 3: 300, 4: 400, 5: 500}


def sadad_fee(check_index, period):
	if check_index == 0 and period in RESIDENCE_PERMIT_FEES:
		return RESIDENCE_PERMIT_FEES[period], "003"
	if check_index == 1 and period in SPONSORSHIP_TRANSFER_FEES:
		return SPONSORSHIP_TRANSFER_FEES[period], "007"
	if check_index == 2:
		return 1000, "012"
	if check_index == 3 and period in EXIT_AND_RETURN_FEES:
		return EXIT_AND_RETURN_FEES[period], "004"
	if check_index == 4:
		return 100, "018"
	return 0, ""


class SADADGroup(Document):
	def validate(self):
		self.total_amount = sum(flt(row.amount) for row in self.table12)

	@frappe.whitelist()
	def build_fee_table(self):
		period = cint(self.period)
		for employee in self.employeelist.split("\n") if self.employeelist else []:
			for check_index, check in enumerate(SADAD_CHECKS):
				if not cint(self.get(check)):
					continue
				amount, service = sadad_fee(check_index, period)
				self.append(
					"table12",
					{
						"employee": employee,
						"type": SADAD_TYPES[check_index],
						"period": self.period,
						"amount": amount,
						"biller": SADAD_BILLER,
						"service": service,
						"date": self.bank_payment_date,
					},
				)
		self.total_amount = sum(flt(row.amount) for row in self.table12)
		self.employeelist = ""
		self.period = None
		self.bank_payment_date = None
		for check in SADAD_CHECKS:
			self.set(check, 0)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, today

FEE_TRACKING_DOCTYPE = "Iqama Renewal Fee Tracking"
FEE_TRACKING_ROW_FIELDS = (
	"employee",
	"employee_name",
	"iqama_expiration_date",
	"department",
	"cost_center",
	"company_name",
	"corporation",
	"file_no",
)


class IqamaRenewalManagement(Document):
	def validate(self):
		errors = [
			_("Row {0}: please select the renewal period for employee {1}.", context="Iqama Renewal Management").format(row.idx, row.employee)
			for row in self.employees_details
			if row.renewal_preference == "Yes" and not row.renewal_period
		]
		if errors:
			frappe.throw("<br>".join(errors), title=_("Input Errors", context="Iqama Renewal Management"))

	def before_save(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.apply_renewal_decisions()
		self.refill_employees_details()

	def apply_renewal_decisions(self):
		decided = [row for row in self.employees_details if row.renewal_preference]
		skipped = len(self.employees_details) - len(decided)
		for row in decided:
			tracking = frappe.get_doc(FEE_TRACKING_DOCTYPE, row.name1)
			tracking.update(
				{
					"status": "Waiting Sadad" if row.renewal_preference == "Yes" else "Rejected",
					"renewal_period": cint(row.renewal_period) if row.renewal_period else None,
					"renewal_preference": row.renewal_preference,
					"reason_of_not_renewal": row.reason_of_not_renewal,
					"approved_by": frappe.session.user,
					"approval_date": today(),
				}
			)
			tracking.save()
		if decided:
			frappe.msgprint(
				_("Updated the data of {0} employees.", context="Iqama Renewal Management").format(len(decided)), indicator="green", alert=True
			)
		if skipped:
			frappe.msgprint(
				_("{0} rows were skipped because no renewal option was set.", context="Iqama Renewal Management").format(skipped),
				indicator="orange",
				alert=True,
			)

	def refill_employees_details(self):
		filters = {"status": "New"}
		if self.department:
			filters["department"] = self.department
		if self.corporation:
			filters["corporation"] = self.corporation
		self.set("employees_details", [])
		for tracking in frappe.get_list(
			FEE_TRACKING_DOCTYPE,
			filters=filters,
			fields=[*FEE_TRACKING_ROW_FIELDS, "name"],
			limit_page_length=1000,
		):
			row = {field: tracking.get(field) for field in FEE_TRACKING_ROW_FIELDS}
			row["name1"] = tracking.name
			self.append("employees_details", row)

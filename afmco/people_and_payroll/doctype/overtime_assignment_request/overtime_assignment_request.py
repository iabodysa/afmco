import frappe
from frappe.model.document import Document


class OvertimeAssignmentRequest(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.calculate_overtime()

	def calculate_overtime(self):
		flt = frappe.utils.flt
		date_diff = frappe.utils.date_diff

		if self.start_date and self.end_date:
			self.total_days = date_diff(self.end_date, self.start_date) + 1
		else:
			self.total_days = 0

		if self.base_salary:
			self.hourly_rate = flt(self.base_salary) / 30 / 8
		else:
			self.hourly_rate = 0

		hours = flt(self.actual_hours) if self.actual_hours else flt(self.scheduled_hours)
		if hours and self.hourly_rate:
			self.total_amount = hours * flt(self.hourly_rate)
		else:
			self.total_amount = 0

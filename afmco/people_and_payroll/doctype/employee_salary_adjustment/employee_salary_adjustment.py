import frappe
from dateutil.relativedelta import relativedelta
from frappe import _
from frappe.model.document import Document


class EmployeeSalaryAdjustment(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.calculate_salary_increase()

	def calculate_salary_increase(self):
		increase_matrix = {
			1: {"fixed_increase": 50, "rate": 10},
			2: {"fixed_increase": 100, "rate": 20},
			3: {"fixed_increase": 150, "rate": 30},
			4: {"fixed_increase": 200, "rate": 40},
			5: {"fixed_increase": 300, "rate": 50},
			6: {"fixed_increase": 400, "rate": 60},
			7: {"fixed_increase": 500, "rate": 70},
			8: {"fixed_increase": 600, "rate": 80},
			9: {"fixed_increase": 800, "rate": 90},
			10: {"fixed_increase": 1000, "rate": 100}
		}

		if self.grade not in increase_matrix:
			frappe.throw(_("Grade must be between 1 and 10."))

		if self.date_of_joining:
			today = frappe.utils.nowdate()
			years_of_service = relativedelta(frappe.utils.getdate(today), frappe.utils.getdate(self.date_of_joining)).years
			self.years_of_service = years_of_service

		fixed_increase = increase_matrix[self.grade]['fixed_increase']
		rate_per_year = increase_matrix[self.grade]['rate']

		flexible_increase = fixed_increase * (self.increase_rate / 100)

		total_increase = flexible_increase + (rate_per_year * self.years_of_service)

		if self.last_month_salary_last_year:
			salary_diff = self.last_month_salary - self.last_month_salary_last_year
		else:
			salary_diff = 0

		self.unexpected_increase = salary_diff

		if self.adjust_for_previous_salary_diff:
			final_increase = total_increase - salary_diff
			if final_increase < 0:
				final_increase = 0
		else:
			final_increase = total_increase

		self.calculated_increase = final_increase
		self.total_new_salary = self.last_month_salary + final_increase

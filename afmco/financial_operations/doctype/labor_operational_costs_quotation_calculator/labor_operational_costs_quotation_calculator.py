# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class LaborOperationalCostsQuotationCalculator(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.calculate_operational_costs()

	def calculate_operational_costs(self):
		if self.contract_start_date and self.contract_end_date:
			start_date = frappe.utils.getdate(self.contract_start_date)
			end_date = frappe.utils.getdate(self.contract_end_date)
			diff_days = (end_date - start_date).days
			self.contract_duration = diff_days // 30.15

		monthly_salary = self.monthly_salary or 0
		if monthly_salary:
			food_allowance = 200 if monthly_salary > 200 else 0
			remaining_salary = monthly_salary - food_allowance
			self.basic_salary = remaining_salary * 0.65
			self.housing_allowance = remaining_salary * 0.25
			self.transportation_allowance = remaining_salary * 0.1
			self.food_allowance = food_allowance
		else:
			self.basic_salary = 0
			self.housing_allowance = 0
			self.transportation_allowance = 0
			self.food_allowance = 0

		gosi = (monthly_salary - food_allowance) * 0.02
		self.gosi = gosi

		end_of_service = ((monthly_salary - food_allowance) * 0.5) / 12
		self.end_of_service = end_of_service

		leave_salary = ((monthly_salary - food_allowance) / 30 * 21) / 12
		self.leave_salary = leave_salary

		basic_salary = self.basic_salary or 0
		food_allowance = self.food_allowance or 0
		housing_allowance = self.housing_allowance or 0
		transportation_allowance = self.transportation_allowance or 0
		annual_air_ticket = (self.annual_air_ticket or 0) / 12
		exit_and_reentry_visa_fees = (self.exit_and_reentry_visa_fees or 0) / 12
		medical_insurance = (self.medical_insurance or 0) / 12
		visa_cost = (self.visa_cost or 0) / 24 if self.employment_type == 'Recruitment' else 0
		medical_exam_fee = (self.medical_exam_fee or 0) / 24 if self.employment_type == 'Recruitment' else 0
		iqama_cost = (self.iqama_cost or 0) / 12
		work_permit = (self.work_permit or 0) / 12
		sponsorship_transfer_fees = (self.sponsorship_transfer_fees or 0) / 24 if self.employment_type == 'Sponsorship Transfer' else 0
		agency_fees = (self.agency_fees or 0) / 24
		ajeer_fees = (self.ajeer_fees or 0) / 12
		saudization_expenses = self.saudization_expenses or 0

		uniform_cost = (self.uniform_cost / 12 if self.position == 'Worker' and self.specific_costs == 1 else 0)
		safety_shoes_cost = (self.safety_shoes_cost / 12 if self.position == 'Worker' and self.specific_costs == 1 else 0)
		cleaning_supplies_cost = (self.cleaning_supplies_cost or 0) if self.position == 'Worker' else 0
		mobile_cost = (self.mobile_cost / 12 if self.position == 'Delivery Representative' and self.specific_costs == 1 else 0)
		sim_card_cost = (self.sim_card_cost or 0) if self.position == 'Delivery Representative' and self.specific_costs == 1 else 0
		vehicle_cost = (self.vehicle_cost or 0) if self.position == 'Delivery Representative' and self.specific_costs == 1 else 0
		fuel_cost = (self.fuel_cost or 0) if self.position == 'Delivery Representative' and self.specific_costs == 1 else 0
		housing_cost = (self.housing_cost or 0) if self.housing_and_transportation == 1 else 0
		transportation_cost = (self.transportation_cost or 0) if self.housing_and_transportation == 1 else 0
		health_certificate_cost = (self.health_certificate_cost or 0) / 24 if self.toggle_health_certificate == 1 else 0

		commissions = self.commissions or 0
		general_administrative_expenses = self.general_administrative_expenses or 0
		profit_margin = self.profit_margin or 0

		working_hours_per_day = self.hours_per_day or 8

		if working_hours_per_day > 8:
			overtime_hours_per_day = working_hours_per_day - 8
			overtime_hourly_rate = ((monthly_salary - food_allowance) / 30) / 8 * 1.5
			overtime_cost = overtime_hours_per_day * overtime_hourly_rate * 26
		else:
			overtime_cost = 0

		total_cost_per_worker = (
			basic_salary + food_allowance + housing_allowance + transportation_allowance +
			annual_air_ticket + leave_salary + end_of_service + medical_insurance + exit_and_reentry_visa_fees +
			visa_cost + medical_exam_fee + iqama_cost + work_permit +
			sponsorship_transfer_fees + gosi + agency_fees + ajeer_fees +
			uniform_cost + safety_shoes_cost + cleaning_supplies_cost + mobile_cost +
			sim_card_cost + vehicle_cost + fuel_cost + housing_cost + transportation_cost +
			commissions + general_administrative_expenses + saudization_expenses + overtime_cost + health_certificate_cost
		)

		total_cost = total_cost_per_worker * (self.number_to_hire or 1)

		cost_excl_salary_vat = (
			annual_air_ticket + leave_salary + end_of_service + medical_insurance + exit_and_reentry_visa_fees +
			visa_cost + medical_exam_fee + iqama_cost + work_permit +
			sponsorship_transfer_fees + gosi + agency_fees + ajeer_fees +
			uniform_cost + safety_shoes_cost + cleaning_supplies_cost + mobile_cost +
			sim_card_cost + vehicle_cost + fuel_cost + housing_cost + transportation_cost +
			commissions + general_administrative_expenses + saudization_expenses + health_certificate_cost
		)

		discount_rate = self.discount_rate or 0
		discount = total_cost * (discount_rate / 100) if discount_rate != 0 else 0

		individual_profit = total_cost_per_worker * (profit_margin / 100)

		self.total_cost_with_profit = total_cost * (1 + (profit_margin / 100))

		net_total_cost_with_profit = self.total_cost_with_profit - discount

		self.vat = net_total_cost_with_profit * 0.15

		self.total_cost_with_profit_and_vat = net_total_cost_with_profit + self.vat

		self.total_monthly_billing = total_cost_per_worker * (1 + (profit_margin / 100))

		self.overtime_cost = overtime_cost

		self.cost_excl_salary_vat = cost_excl_salary_vat

		self.individual_profit = individual_profit

		self.discount = discount

		self.total_profit = individual_profit * (self.number_to_hire or 1)

		self.workers_contract_duration_cost = self.total_monthly_billing * self.contract_duration or 0

		self.cost_with_vat_duration = self.total_cost_with_profit_and_vat * self.contract_duration or 0

# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class Barncafe(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		absence_deduction2: DF.Data | None
		absence_deduction: DF.Data | None
		absentcontracting: DF.Data | None
		actual_working_days: DF.Data | None
		bank_name: DF.Data | None
		basic_salary: DF.Data | None
		branch: DF.Data | None
		branch_name: DF.Data | None
		contract_basic_salary: DF.Data | None
		contract_start_date: DF.Date | None
		decrease_pay_transactions_leave: DF.Data | None
		department: DF.Data | None
		employment_type: DF.Data | None
		general_deduction: DF.Data | None
		grade: DF.Data | None
		iban: DF.Data | None
		increase_pay_transactions_leave: DF.Data | None
		name1: DF.Data | None
		national__iqama_id: DF.Data | None
		nationality: DF.Data | None
		notes: DF.Data | None
		op_bonus: DF.Data | None
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		payment_methods: DF.Data | None
		personnel_number: DF.Link | None
		position: DF.Data | None
		reason: DF.Data | None
		total_leave_days: DF.Data | None
		total_overtime_hours: DF.Data | None
		working_days: DF.Data | None
		أخرى: DF.Data | None
		اجمالي_الخصميات: DF.Data | None
		الاجازات: DF.Data | None
		التاخير: DF.Data | None
		التامينات_الاجتماعية: DF.Data | None
		السلف: DF.Data | None
		الغياب: DF.Data | None
		بدل_سكن: DF.Data | None
		بدل_طعام: DF.Data | None
		بدل_عمل_اضافي: DF.Data | None
		بدل_مواصلات: DF.Data | None
		بدلات_اخرى: DF.Data | None
		بدلات_خاصه: DF.Data | None
		تعديل_اجازة: DF.Data | None
		تعديل_الراتب1: DF.Data | None
		تعديل_الراتب: DF.Data | None
		عقوبات: DF.Data | None
		نقص_المبيعات: DF.Data | None
	# end: auto-generated types
	pass

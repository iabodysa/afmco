# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class ildressLabours(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		erp: DF.Data | None
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		أيام_الخصم: DF.Data | None
		أيام_العمل_الفعلية: DF.Data | None
		إسم_المحطة: DF.Data | None
		اسم_العامل: DF.Data | None
		الجنسية: DF.Data | None
		الفرع: DF.Data | None
		الملاحظات: DF.Data | None
		تاريخ_بداية_العمل: DF.Data | None
		راتب__مايو_الى: DF.Date | None
		راتب_مايو_من: DF.Date | None
		رقم_الإقامة: DF.Data | None
		رقم_المحطة: DF.Data | None
		رقم_جواز_السفر: DF.Data | None
		عدد_الأيام: DF.Data | None
	# end: auto-generated types
	pass

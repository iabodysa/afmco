# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class Alosaimitimesheet(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		absent: DF.Data | None
		basic_salary: DF.Data | None
		company: DF.Data | None
		dedaction: DF.Data | None
		friday_ot_h: DF.Data | None
		gross_salary: DF.Data | None
		loan: DF.Data | None
		name1: DF.Data | None
		normal_ot_h: DF.Data | None
		other_allw: DF.Data | None
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		salary: DF.Data | None
		total: DF.Data | None
		total_ot: DF.Data | None
		work_location: DF.Data | None
		wroking_days: DF.Data | None
	# end: auto-generated types
	pass

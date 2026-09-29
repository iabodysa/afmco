# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class SMSA(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		card: DF.Data | None
		ecom: DF.Data | None
		emp_name: DF.Data | None
		emp_no: DF.Data | None
		gov_card: DF.Data | None
		job_title: DF.Data | None
		loc: DF.Data | None
		outsource_co: DF.Data | None
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		performance: DF.Data | None
		promo_1: DF.Data | None
		promo_2: DF.Data | None
		pup: DF.Data | None
		rgn: DF.Data | None
		spo: DF.Data | None
		station: DF.Data | None
		total: DF.Data | None
		type: DF.Data | None
	# end: auto-generated types
	pass

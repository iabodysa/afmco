# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

from frappe.model.document import Document


class FirstMile(Document):
	# begin: auto-generated types
	# This code is auto-generated. Do not modify anything in this block.

	from typing import TYPE_CHECKING

	if TYPE_CHECKING:
		from frappe.types import DF

		absents: DF.Data | None
		emp: DF.Data | None
		emp_name: DF.Link | None
		id: DF.Data | None
		loc: DF.Data | None
		month: DF.Data | None
		parent: DF.Data
		parentfield: DF.Data
		parenttype: DF.Data
		remarks: DF.SmallText | None
		sec: DF.Data | None
		total_no_days: DF.Data | None
	# end: auto-generated types
	pass

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.utils import flt

from erpnext.regional.united_arab_emirates.utils import (
	update_itemised_tax_data as update_regional_itemised_tax_data,
)


def update_itemised_tax_data(doc):
	update_regional_itemised_tax_data(doc)

	if not doc.get("items") or not doc.items[0].meta.has_field("tax_amount"):
		return
	if flt(doc.get("conversion_rate")) != 1:
		return

	line_tax = {}
	for detail in doc.get("_item_wise_tax_details") or []:
		item, tax = detail.get("item"), detail.get("tax")
		if not item or not tax or tax.get("category") == "Valuation":
			continue
		line_tax[id(item)] = line_tax.get(id(item), 0.0) + flt(detail.get("amount"))

	for row in doc.items:
		if id(row) not in line_tax:
			continue
		row.tax_amount = flt(line_tax[id(row)], row.precision("tax_amount"))
		row.total_amount = flt(row.net_amount + row.tax_amount, row.precision("total_amount"))

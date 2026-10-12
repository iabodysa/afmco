# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.rate_limiter import rate_limit

from afmco.people_and_payroll.iban_request import create_request

REQUEST_FIELDS = (
	"employee_id",
	"iban",
	"account_holder",
	"account_holder_name",
	"note",
	"duration",
	"valid_from",
	"valid_until",
	"declaration",
)


@frappe.whitelist(allow_guest=True, methods=["POST"])
@rate_limit(limit=5, seconds=60 * 60)
def submit():
	request = create_request({fieldname: frappe.form_dict.get(fieldname) for fieldname in REQUEST_FIELDS})
	return {"name": request.name}

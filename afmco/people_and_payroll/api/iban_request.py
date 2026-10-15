# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.rate_limiter import rate_limit

from afmco.people_and_payroll.iban_request import MAX_CERTIFICATE_BYTES, create_request

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
@rate_limit(key="employee_id", limit=10, seconds=24 * 60 * 60, ip_based=False)
def submit():
	certificate = frappe.request.files.get("iban_certificate") if frappe.request else None
	request = create_request(
		{fieldname: frappe.form_dict.get(fieldname) for fieldname in REQUEST_FIELDS},
		certificate.filename if certificate else None,
		certificate.stream.read(MAX_CERTIFICATE_BYTES + 1) if certificate else None,
	)
	return {"name": request.name}

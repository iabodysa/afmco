# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cstr, getdate

PAYMENT_REQUEST = "Payment Requisition"
TRACKING = "Iqama Renewal Tracking"
SETUP = "SADAD Setup"
SETUP_ROW = "SADAD Setup Account"
CONTEXT = "Iqama Renewal Tracking"
RENEWAL_TYPE = "Issue or renew residence permit"
WORK_PERMIT_TYPE = "Fees for the financial counterpart of work permits"
DURATION_MONTHS = {"3 months": 3, "6 months": 6, "9 Months": 9, "1 year": 12}
TRACKING_FIELDS = ["name", "employee", "employee_name", "renewal_duration", "sadad_invoice"]


def attach(payment_requisition):
	request = frappe.get_doc(PAYMENT_REQUEST, payment_requisition)
	request.check_permission("read")
	work_cards = _trackers("pr_reference", request.name)
	if work_cards:
		file_name = "SADAD_BILL_PAY.csv"
		lines = ["Biller Company,Subscriber Number"]
		lines.extend(_work_card_line(row) for row in work_cards)
	else:
		renewals = _trackers("pr_reference_2", request.name)
		if not renewals:
			frappe.throw(
				_("No Iqama Renewal Tracking is linked to {0}.", context=CONTEXT).format(request.name)
			)
		file_name = f"JAWAZAT_{getdate().strftime('%d_%b_%y')}.csv"
		lines = ["Biller,Service,Iqama ID,Iqama Duration"]
		lines.extend(_renewal_line(row) for row in renewals)
	file = frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": PAYMENT_REQUEST,
			"attached_to_name": request.name,
			"is_private": 1,
			"content": "\r\n".join(lines) + "\r\n",
		}
	)
	file.insert()
	return {"name": request.name, "file_url": file.file_url, "lines": len(lines) - 1}


def _trackers(link_field, payment_requisition):
	return frappe.get_list(
		TRACKING,
		filters={link_field: payment_requisition},
		fields=TRACKING_FIELDS,
		order_by="name asc",
	)


def _work_card_line(row):
	if not cstr(row.sadad_invoice).strip():
		frappe.throw(
			_("Document {0} for employee {1} has no SADAD number.", context=CONTEXT).format(
				row.name, row.employee_name
			)
		)
	biller, _service = _setup_codes(WORK_PERMIT_TYPE, row)
	return f"{biller},{cstr(row.sadad_invoice).strip()}"


def _renewal_line(row):
	biller, service = _setup_codes(RENEWAL_TYPE, row)
	return f"{biller},{service},{row.employee},{_months(row):03d}"


def _setup_codes(fee_type, row):
	codes = frappe.db.get_value(
		SETUP_ROW,
		{"parent": SETUP, "types_english": fee_type, "period": _months(row), "period_unit": "Month"},
		["biller", "service_codes"],
	)
	if not codes or not codes[0]:
		frappe.throw(
			_("SADAD Setup has no biller code for {0} ({1} months).", context=CONTEXT).format(
				_(fee_type), _months(row)
			)
		)
	return cstr(codes[0]).strip(), cstr(codes[1]).strip()


def _months(row):
	months = DURATION_MONTHS.get(row.renewal_duration)
	if not months:
		frappe.throw(
			_("Document {0} for employee {1} has no renewal duration.", context=CONTEXT).format(
				row.name, row.employee_name
			)
		)
	return months

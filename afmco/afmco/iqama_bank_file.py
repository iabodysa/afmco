# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import cstr, getdate

from afmco.afmco.doctype.payment_requisition.payment_requisition import set_sadad_bill

PAYMENT_REQUEST = "Payment Requisition"
TRACKING = "Iqama Renewal Tracking"
CONTEXT = "Iqama Renewal Tracking"
JAWAZAT_BILLER = "090"
JAWAZAT_SERVICE = "003"
WORK_PERMIT_BILLER = "050"
DURATION_MONTHS = {"3 months": 3, "6 months": 6, "9 Months": 9, "1 year": 12}
WORK_CARDS = "PR Created for Work Cards"
IQAMA_RENEWAL = "PR Created for Iqama Renewal"
EXIT_REENTRY_VISA = "Exit Re-entry Visa"
REQUISITION_TYPE = {
	WORK_CARDS: "Work Permit Fee Payment",
	IQAMA_RENEWAL: "Passport Fee Payment",
	EXIT_REENTRY_VISA: "SADAD Payment",
}
TRACKING_FIELDS = ["name", "employee", "employee_name", "renewal_duration", "sadad_invoice"]


def create_with_bank_file(payment_requisition, payment_type, trackers=None):
	request = frappe.get_doc(frappe.parse_json(payment_requisition))
	request.payment_type = REQUISITION_TYPE[payment_type]
	if payment_type == EXIT_REENTRY_VISA:
		return request.insert().as_dict()
	rows = _trackers(frappe.parse_json(trackers))
	file_name, content = _bank_file(payment_type, rows)
	_set_bill(request, payment_type, rows)
	request.insert()
	frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": PAYMENT_REQUEST,
			"attached_to_name": request.name,
			"is_private": 1,
			"content": content,
		}
	).insert()
	return request.as_dict()


def _trackers(trackers):
	return frappe.get_list(
		TRACKING,
		filters={"name": ["in", trackers]},
		fields=TRACKING_FIELDS,
		order_by="name asc",
	)


def _set_bill(request, payment_type, rows):
	if payment_type == WORK_CARDS:
		set_sadad_bill(request, WORK_PERMIT_BILLER, [cstr(row.sadad_invoice).strip() for row in rows])
	else:
		set_sadad_bill(request, JAWAZAT_BILLER, [cstr(row.employee).strip() for row in rows])


def _bank_file(payment_type, rows):
	if payment_type == WORK_CARDS:
		file_name = "SADAD_BILL_PAY.csv"
		lines = ["Biller Company,Subscriber Number"]
		lines.extend(_work_card_line(row) for row in rows)
	elif payment_type == IQAMA_RENEWAL:
		file_name = f"JAWAZAT_{getdate().strftime('%d_%b_%y')}.csv"
		lines = ["Biller,Service,Iqama ID,Iqama Duration"]
		lines.extend(_renewal_line(row) for row in rows)
	else:
		frappe.throw(_("Payment type {0} has no bank file layout.", context=CONTEXT).format(payment_type))
	return file_name, "\r\n".join(lines) + "\r\n"


def _work_card_line(row):
	if not cstr(row.sadad_invoice).strip():
		frappe.throw(
			_("Document {0} for employee {1} has no SADAD number.", context=CONTEXT).format(
				row.name, row.employee_name
			)
		)
	return f"{WORK_PERMIT_BILLER},{cstr(row.sadad_invoice).strip()}"


def _renewal_line(row):
	return f"{JAWAZAT_BILLER},{JAWAZAT_SERVICE},{row.employee},{_months(row):03d}"


def _months(row):
	months = DURATION_MONTHS.get(row.renewal_duration)
	if not months:
		frappe.throw(
			_("Document {0} for employee {1} has no renewal duration.", context=CONTEXT).format(
				row.name, row.employee_name
			)
		)
	return months

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from erpnext.selling.doctype.customer.customer_overview import PERIODS, resolve_period
from frappe.utils import cint, getdate, today
from hrms.overrides import employee_overview as hrms_overview


def hides_fields(doctype):
	meta = frappe.get_meta(doctype)
	return not {cint(df.permlevel) for df in meta.fields} <= set(meta.get_permlevel_access("read"))


def readable(doctype):
	return frappe.has_permission(doctype, "read") and not hides_fields(doctype)


def restricted():
	return any(
		frappe.has_permission(doctype, "read") and hides_fields(doctype)
		for doctype in hrms_overview.TRANSACTION_TYPES
	)


def overview(employee, period):
	company = hrms_overview.check_access(employee)

	if period not in PERIODS:
		period = "Current Fiscal Year"

	as_of = getdate(today())
	from_date, to_date = resolve_period(period, company, as_of)
	currency = frappe.get_cached_value("Company", company, "default_currency")
	payroll = readable("Salary Slip")

	payload = {
		"employee": employee,
		"company": company,
		"currency": currency,
		"period": period,
		"period_range": {"from_date": str(from_date), "to_date": str(to_date)},
		"as_of": str(as_of),
		"permissions": {"payroll": payroll},
		"errors": {},
		"pay": None,
	}

	tiles = [
		("attendance", hrms_overview.attendance, (employee, from_date, min(to_date, as_of))),
		("leave", hrms_overview.leave_balances, (employee, as_of)),
		("pipeline", pipeline, (employee, company, currency)),
	]
	if payroll:
		tiles.insert(0, ("pay", hrms_overview.pay, (employee, company, from_date, to_date)))

	for key, fn, args in tiles:
		try:
			payload[key] = fn(*args)
		except Exception:
			payload[key] = None
			payload["errors"][key] = 1
			frappe.log_error(title="Employee Overview: " + key)

	return payload


def pipeline(employee, company, currency):
	tiles = {}
	if readable("Leave Application"):
		tiles["leave_requests"] = hrms_overview.open_leave_requests(employee)
	if readable("Expense Claim"):
		tiles.update(hrms_overview.claim_tiles(employee, company))
	if readable("Employee Advance"):
		tiles["advances"] = hrms_overview.advance_tile(employee, company, currency)
	return tiles


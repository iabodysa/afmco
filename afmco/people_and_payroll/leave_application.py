# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.utils import add_days, formatdate, getdate, nowdate
from frappe.utils.user import get_users_with_role

from afmco.people_and_payroll.employee import ON_LEAVE_STATUS

NO_SHOW_ALERT_DAYS = 10
NO_SHOW_ALERT_ROLE = "HR Manager"


def set_employees_on_leave():
	today = nowdate()
	on_leave_today = frappe.get_all(
		"Leave Application",
		filters={"status": "Approved", "from_date": ("<=", today), "to_date": (">=", today)},
		pluck="employee",
		distinct=True,
	)
	for name in frappe.get_all("Employee", filters={"name": ("in", on_leave_today), "status": "Active"}, pluck="name"):
		frappe.get_doc("Employee", name).db_set("status", ON_LEAVE_STATUS)


def latest_approved_leaves(employees):
	latest = {}
	for row in frappe.get_all(
		"Leave Application",
		filters={"employee": ("in", list(employees)), "docstatus": 1, "status": "Approved"},
		fields=["name", "employee", "employee_name", "to_date"],
		order_by="to_date asc",
	):
		latest[row.employee] = row
	return latest


def employees_not_returned(employees, as_of) -> set[str]:
	employees = list(employees)
	if not employees:
		return set()
	on_leave = frappe.get_all("Employee", filters={"name": ("in", employees), "status": ON_LEAVE_STATUS}, pluck="name")
	if not on_leave:
		return set()
	return {
		employee
		for employee, leave in latest_approved_leaves(on_leave).items()
		if getdate(leave.to_date) < getdate(as_of)
	}


def alert_hr_of_employees_not_returned():
	cutoff = getdate(add_days(nowdate(), -NO_SHOW_ALERT_DAYS))
	on_leave = frappe.get_all("Employee", filters={"status": ON_LEAVE_STATUS}, pluck="name")
	due = [leave for leave in latest_approved_leaves(on_leave).values() if getdate(leave.to_date) <= cutoff]
	users = get_users_with_role(NO_SHOW_ALERT_ROLE) if due else []
	for leave in due if users else []:
		enqueue_create_notification(
			users,
			{
				"type": "Alert",
				"document_type": "Leave Application",
				"document_name": leave.name,
				"subject": _("{0} has not resumed work {1} days after leave ended on {2}").format(
					leave.employee_name, NO_SHOW_ALERT_DAYS, formatdate(leave.to_date)
				),
			},
			dedupe_on=["document_type", "document_name", "subject"],
		)

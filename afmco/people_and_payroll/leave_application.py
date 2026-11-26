# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from collections import defaultdict
from contextlib import contextmanager

import frappe
from frappe import _
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.utils import (
	add_days,
	escape_html,
	formatdate,
	get_fullname,
	get_url_to_form,
	getdate,
	now_datetime,
	nowdate,
)
from frappe.utils.user import get_users_with_role
from hrms.hr.doctype.leave_application.leave_application import get_employee_leave_approver
from hrms.utils import get_employee_email

from afmco.people_and_payroll.employee import ON_LEAVE_STATUS

NO_SHOW_ALERT_DAYS = 10
NO_SHOW_ALERT_ROLE = "HR Manager"
REJECTION_WINDOW_DAYS = 90
REJECTION_ALERT_ROLE = "HR Manager"
REJECTION_ALERT_SECONDS = 86400


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


def annual_leave_types() -> list[str]:
	return frappe.get_all("Leave Type", filters={"is_earned_leave": 1}, pluck="name")


def mail_repeat_rejection_alert(
	leave_application, employee, employee_name, from_date, to_date, rejected_by, rejected_on
):
	link = get_url_to_form("Leave Application", leave_application)
	period = _("{0} to {1}").format(formatdate(from_date), formatdate(to_date))
	hr_users = get_users_with_role(REJECTION_ALERT_ROLE)
	if hr_users:
		frappe.sendmail(
			recipients=hr_users,
			subject=_("Annual leave of {0} cannot be rejected again").format(employee_name),
			message=_(
				"{0} tried to reject the annual leave of {1} ({2}). An annual leave of {1} was rejected on {3}, within the last {4} days, so this request must be approved."
			).format(escape_html(rejected_by), escape_html(employee_name), period, rejected_on, REJECTION_WINDOW_DAYS)
			+ f'<p><a href="{link}">{leave_application}</a></p>',
			reference_doctype="Leave Application",
			reference_name=leave_application,
		)
	employee_email = get_employee_email(employee)
	if employee_email:
		frappe.sendmail(
			recipients=[employee_email],
			subject=_("Your annual leave request {0}").format(leave_application),
			message=_(
				"Your annual leave request ({0}) cannot be rejected, because an annual leave of yours was rejected on {1}, within the last {2} days. It has to be approved."
			).format(period, rejected_on, REJECTION_WINDOW_DAYS),
			reference_doctype="Leave Application",
			reference_name=leave_application,
		)


def leave_approvers_of(leave, employees, managers, department_approvers) -> list[str]:
	if leave.leave_approver:
		return [leave.leave_approver]
	employee = employees.get(leave.employee)
	if employee and managers.get(employee.reports_to):
		return [managers[employee.reports_to]]
	return department_approvers.get(employee.department, []) if employee else []


def mail_open_leave_digest():
	open_leaves = frappe.get_all(
		"Leave Application",
		filters={"status": "Open", "docstatus": 0},
		fields=["name", "employee", "employee_name", "leave_type", "from_date", "to_date", "leave_approver"],
		order_by="from_date asc",
	)
	if not open_leaves:
		return
	employees = {
		row.name: row
		for row in frappe.get_all(
			"Employee",
			filters={"name": ("in", list({leave.employee for leave in open_leaves}))},
			fields=["name", "department", "reports_to"],
		)
	}
	managers = dict(
		frappe.get_all(
			"Employee",
			filters={
				"name": ("in", [e.reports_to for e in employees.values() if e.reports_to]),
				"user_id": ("is", "set"),
			},
			fields=["name", "user_id"],
			as_list=True,
		)
	)
	department_approvers = defaultdict(list)
	for row in frappe.get_all(
		"Department Approver",
		filters={
			"parentfield": "leave_approvers",
			"parent": ("in", [e.department for e in employees.values() if e.department]),
		},
		fields=["parent", "approver"],
		order_by="idx asc",
	):
		department_approvers[row.parent].append(row.approver)
	by_approver = defaultdict(list)
	for leave in open_leaves:
		for approver in leave_approvers_of(leave, employees, managers, department_approvers):
			by_approver[approver].append(leave)
	emails = dict(
		frappe.get_all(
			"User", filters={"name": ("in", list(by_approver)), "enabled": 1}, fields=["name", "email"], as_list=True
		)
	)
	for approver, leaves in by_approver.items():
		if not emails.get(approver):
			continue
		rows = "".join(
			'<li><a href="{0}">{1}</a></li>'.format(
				get_url_to_form("Leave Application", leave.name),
				_("{0}: {1} from {2} to {3}").format(
					escape_html(leave.employee_name),
					_(leave.leave_type),
					formatdate(leave.from_date),
					formatdate(leave.to_date),
				),
			)
			for leave in leaves
		)
		frappe.sendmail(
			recipients=[emails[approver]],
			subject=_("Leave requests waiting for your decision ({0})").format(len(leaves)),
			message="<p>{0}</p><ul>{1}</ul>".format(_("These leave requests are waiting for your decision:"), rows),
		)


class AfmcoLeaveApplication:
	def validate(self):
		super().validate()
		if self.status == "Rejected" and self.leave_type in annual_leave_types():
			self.validate_repeat_rejection()
			self.validate_rejection_reason()

	def validate_repeat_rejection(self):
		previous = frappe.get_all(
			"Leave Application",
			filters={
				"employee": self.employee,
				"status": "Rejected",
				"docstatus": 1,
				"name": ("!=", self.name),
				"leave_type": ("in", annual_leave_types()),
				"modified": (">=", add_days(now_datetime(), -REJECTION_WINDOW_DAYS)),
			},
			fields=["modified"],
			order_by="modified desc",
			limit=1,
		)
		if not previous:
			return
		rejected_on = formatdate(previous[0].modified)
		self.alert_repeat_rejection(rejected_on)
		frappe.throw(
			_("{0} was refused annual leave on {1}, within the last {2} days. This request must be approved.").format(
				self.employee_name, rejected_on, REJECTION_WINDOW_DAYS
			),
			title=_("Rejection Not Allowed"),
		)

	def alert_repeat_rejection(self, rejected_on):
		first_attempt = frappe.cache.set(
			frappe.cache.make_key(f"afmco:repeat-rejection-alert:{self.name}"), 1, nx=True, ex=REJECTION_ALERT_SECONDS
		)
		if not first_attempt:
			return
		frappe.enqueue(
			mail_repeat_rejection_alert,
			leave_application=self.name,
			employee=self.employee,
			employee_name=self.employee_name,
			from_date=self.from_date,
			to_date=self.to_date,
			rejected_by=get_fullname(frappe.session.user),
			rejected_on=rejected_on,
		)

	def validate_rejection_reason(self):
		if not (self.rejection_reason or "").strip():
			frappe.throw(_("Write the reason for rejecting this annual leave."), title=_("Rejection Reason Required"))

	def validate_balance_leaves(self):
		with guest_web_form_balance_read():
			return super().validate_balance_leaves()

	def get_consecutive_leave_details(self) -> dict:
		with guest_web_form_balance_read():
			return super().get_consecutive_leave_details()

	def validate_leave_approver(self):
		if is_guest_web_form() and not self.leave_approver:
			self.leave_approver = get_employee_leave_approver(self.employee)
		return super().validate_leave_approver()


def is_guest_web_form() -> bool:
	return bool(frappe.flags.in_web_form) and frappe.session.user == "Guest"


@contextmanager
def guest_web_form_balance_read():
	if not is_guest_web_form():
		yield
		return
	frappe.session.user = "Administrator"
	try:
		yield
	finally:
		frappe.session.user = "Guest"

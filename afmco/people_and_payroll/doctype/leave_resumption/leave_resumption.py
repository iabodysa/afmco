# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_days, date_diff, getdate, today
from hrms.hr.utils import get_holiday_dates_for_employee

from afmco.people_and_payroll.employee import ON_LEAVE_STATUS
from afmco.people_and_payroll.salary_slip import ACTIVE_STATUS

ON_TIME = "On Time"
EARLY = "Early"
LATE = "Late"
LEAVE_WITHOUT_PAY = "Leave Without Pay"
ABSENT = "Absent"
APPROVED = "Approved"


class LeaveResumption(Document):
	def validate(self):
		self.validate_leave_application()
		self.set_return_type()
		self.advance_leave_salary = frappe.db.get_value(
			"Advance Leave Salary",
			{"employee": self.employee, "docstatus": 1},
			"name",
			order_by="creation desc",
		)

	def validate_leave_application(self):
		leave = frappe.db.get_value(
			"Leave Application", self.leave_application, ["docstatus", "status"], as_dict=True
		)
		if leave.docstatus != 1 or leave.status != APPROVED:
			frappe.throw(_("Leave Application {0} is not approved").format(self.leave_application))
		resumption = getdate(self.resumption_date)
		if resumption > getdate(today()):
			frappe.throw(_("Resumption Date cannot be in the future"))
		if resumption <= getdate(self.from_date):
			frappe.throw(_("Resumption Date must be after the leave start date"))
		recorded = frappe.get_all(
			"Leave Resumption",
			filters={"docstatus": 1, "name": ("!=", self.name)},
			or_filters={
				"leave_application": self.leave_application,
				"amended_leave_application": self.leave_application,
				"late_leave_application": self.leave_application,
			},
			pluck="name",
			limit=1,
		)
		if recorded:
			frappe.throw(_("Leave Resumption {0} already records this leave").format(recorded[0]))

	def set_return_type(self):
		to_date = getdate(self.to_date)
		resumption = getdate(self.resumption_date)
		if resumption <= to_date:
			self.return_type = EARLY
			self.days_difference = date_diff(to_date, resumption) + 1
		elif self.late_working_dates():
			self.return_type = LATE
			self.days_difference = date_diff(resumption, to_date) - 1
		else:
			self.return_type = ON_TIME
			self.days_difference = 0
		if self.return_type != LATE:
			self.late_treatment = None

	def late_dates(self):
		return add_days(self.to_date, 1), add_days(self.resumption_date, -1)

	def late_working_dates(self):
		start, end = self.late_dates()
		if getdate(start) > getdate(end):
			return []
		holidays = set(get_holiday_dates_for_employee(self.employee, start, end))
		return [
			day
			for day in (add_days(start, offset) for offset in range(date_diff(end, start) + 1))
			if str(day) not in holidays
		]

	def on_submit(self):
		if self.return_type == EARLY:
			self.shorten_leave()
		elif self.return_type == LATE:
			self.record_late_days()
		self.set_leave_rejoining_date(self.resumption_date)
		self.set_employee_status(ACTIVE_STATUS, self.resumption_date)
		frappe.get_doc("Employee", self.employee).add_comment(
			"Info", _("Employee rejoined after leave on {0}").format(self.resumption_date)
		)

	def before_cancel(self):
		if self.return_type == EARLY:
			frappe.throw(
				_("An early resumption cannot be cancelled. Amend Leave Application {0} instead.").format(
					self.amended_leave_application
				)
			)

	def on_cancel(self):
		if self.late_leave_application:
			cancel_linked("Leave Application", self.late_leave_application)
		for name in (self.late_attendance or "").split():
			cancel_linked("Attendance", name)
		self.set_leave_rejoining_date(None)
		self.set_employee_status(ON_LEAVE_STATUS, None)

	def shorten_leave(self):
		leave = frappe.get_doc("Leave Application", self.leave_application)
		cancel_linked("Leave Application", leave.name)
		shortened = frappe.copy_doc(leave)
		shortened.amended_from = leave.name
		shortened.status = APPROVED
		shortened.to_date = add_days(self.resumption_date, -1)
		shortened.insert()
		shortened.submit()
		self.db_set("amended_leave_application", shortened.name)

	def record_late_days(self):
		start, end = self.late_dates()
		if self.late_treatment == LEAVE_WITHOUT_PAY:
			late = frappe.get_doc(
				{
					"doctype": "Leave Application",
					"employee": self.employee,
					"company": self.company,
					"leave_type": LEAVE_WITHOUT_PAY,
					"from_date": start,
					"to_date": end,
					"status": APPROVED,
					"leave_approver": frappe.db.get_value(
						"Leave Application", self.leave_application, "leave_approver"
					),
					"description": _("Late return from {0}").format(self.leave_application),
				}
			)
			late.insert()
			late.submit()
			self.db_set("late_leave_application", late.name)
			return
		names = []
		for day in self.late_working_dates():
			attendance = frappe.get_doc(
				{
					"doctype": "Attendance",
					"employee": self.employee,
					"company": self.company,
					"attendance_date": day,
					"status": ABSENT,
				}
			)
			attendance.insert()
			attendance.submit()
			names.append(attendance.name)
		self.db_set("late_attendance", "\n".join(names))

	def set_leave_rejoining_date(self, value):
		leaves = (self.amended_leave_application or self.leave_application, self.late_leave_application)
		for name in filter(None, leaves):
			frappe.db.set_value("Leave Application", name, "date_of_rejoing", value)

	def set_employee_status(self, status, rejoining_date):
		employee = frappe.get_doc("Employee", self.employee)
		employee.status = status
		if rejoining_date:
			employee.date_of_rejoining = rejoining_date
		employee.save()


def cancel_linked(doctype, name):
	doc = frappe.get_doc(doctype, name)
	if doc.docstatus != 1:
		return
	doc.flags.ignore_links = True
	doc.cancel()

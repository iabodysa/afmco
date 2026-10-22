# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from collections import defaultdict

import frappe
from frappe import _
from frappe.model.naming import NAMING_SERIES_PATTERN
from frappe.utils import formatdate, getdate
from hrms.payroll.doctype.payroll_entry.payroll_entry import get_employee_list
from hrms.utils.holiday_list import get_holiday_list_ranges_for_employees

from afmco.people_and_payroll.employee import employees_on_hold
from afmco.people_and_payroll.payroll import hold_after_months, last_salary_month

INACTIVE_STATUS = "Inactive"


def held_employee_rows(doc) -> list[dict]:
	listed = {row.employee for row in doc.employees}
	rows = {
		row.employee: row
		for row in get_employee_list(filters=doc.make_filters(), as_dict=True, ignore_match_conditions=True)
		if row.employee not in listed
	}
	held = employees_on_hold(rows)
	return [rows[name] for name in sorted(held)]


def payroll_check(doc) -> dict:
	employees = employee_details([row.employee for row in doc.employees])
	assignments = slip_assignments(doc, employees)
	blockers = []
	info = []
	for name, employee in employees.items():
		blockers.extend(issue(employee, reason) for reason in employee_blockers(doc, employee))
	blockers.extend(
		issue(employees[name], reason) for name, reason in structure_blockers(doc, employees, assignments)
	)
	blockers.extend(issue(employees[name], reason) for name, reason in holiday_list_blockers(doc, employees))
	blockers.extend(
		issue(employees[name], reason) for name, reason in additional_salary_blockers(doc, employees)
	)
	blockers.extend(issue(None, reason) for reason in component_account_blockers(doc, assignments))
	info.extend(
		issue(employees[name], reason) for name, reason in cost_center_info(doc, employees, assignments)
	)
	info.extend(issue(employees[name], reason) for name, reason in existing_slip_info(doc, employees))
	held = [
		{
			"employee": row.employee,
			"employee_name": row.employee_name,
			"department": row.department,
			"last_salary_month": last_salary_month(row.employee),
		}
		for row in held_employee_rows(doc)
	]
	return {"blockers": blockers, "held": held, "held_months": hold_after_months(), "info": info}


def issue(employee, reason) -> dict:
	return {
		"employee": employee.name if employee else None,
		"employee_name": employee.employee_name if employee else None,
		"reason": reason,
	}


def employee_details(names: list[str]) -> dict:
	if not names:
		return {}
	return {
		row.name: row
		for row in frappe.get_all(
			"Employee",
			filters={"name": ["in", names]},
			fields=[
				"name",
				"employee_name",
				"company",
				"status",
				"date_of_joining",
				"relieving_date",
				"department",
				"payroll_cost_center",
			],
		)
	}


def employee_blockers(doc, employee):
	if not NAMING_SERIES_PATTERN.match(f"Sal Slip/{employee.name}/.#####"):
		yield _("Employee ID {0} has a character a salary slip name cannot hold").format(repr(employee.name))
	if employee.status == INACTIVE_STATUS:
		yield _("Inactive employee")
	if not employee.date_of_joining:
		yield _("Date of Joining is missing")
	elif getdate(employee.date_of_joining) > getdate(doc.end_date):
		yield _("Joins after this payroll period")
	if employee.relieving_date and getdate(employee.relieving_date) < getdate(doc.start_date):
		yield _("Left before this payroll period")


def actual_start_date(doc, employee):
	start_date = getdate(doc.start_date)
	joining_date = employee.date_of_joining and getdate(employee.date_of_joining)
	if joining_date and start_date < joining_date <= getdate(doc.end_date):
		return joining_date
	return start_date


def submitted_assignments(doc, employees) -> dict:
	ssa = frappe.qb.DocType("Salary Structure Assignment")
	ss = frappe.qb.DocType("Salary Structure")
	query = (
		frappe.qb.from_(ssa)
		.join(ss)
		.on(ssa.salary_structure == ss.name)
		.select(ssa.name, ssa.employee, ssa.salary_structure, ssa.from_date)
		.where(
			(ssa.docstatus == 1)
			& (ss.docstatus == 1)
			& (ss.is_active == "Yes")
			& (ssa.employee.isin(list(employees)))
		)
		.orderby(ssa.from_date, order=frappe.qb.desc)
	)
	if not doc.salary_slip_based_on_timesheet and doc.payroll_frequency:
		query = query.where(ss.payroll_frequency == doc.payroll_frequency)
	assignments = defaultdict(list)
	for row in query.run(as_dict=True):
		assignments[row.employee].append(row)
	return assignments


def slip_assignment(doc, employee, assignments):
	end_date = getdate(doc.end_date)
	joining_date = employee.date_of_joining and getdate(employee.date_of_joining)
	structure = next(
		(
			row.salary_structure
			for row in assignments
			if getdate(row.from_date) <= end_date or (joining_date and getdate(row.from_date) <= joining_date)
		),
		None,
	)
	start_date = actual_start_date(doc, employee)
	return next(
		(
			row
			for row in assignments
			if row.salary_structure == structure and getdate(row.from_date) <= start_date
		),
		None,
	)


def slip_assignments(doc, employees) -> dict:
	if not employees:
		return {}
	assignments = submitted_assignments(doc, employees)
	return {name: slip_assignment(doc, employee, assignments[name]) for name, employee in employees.items()}


def structure_blockers(doc, employees, assignments):
	for name, assignment in assignments.items():
		if not assignment:
			yield (
				name,
				_("No salary structure assignment from {0} or earlier").format(
					formatdate(actual_start_date(doc, employees[name]))
				),
			)


def holiday_list_blockers(doc, employees):
	covered = get_holiday_list_ranges_for_employees(
		{name: employee.company for name, employee in employees.items()}, doc.start_date, doc.end_date
	)
	for name in employees:
		if name not in covered:
			yield name, _("No holiday list covers this payroll period")


def additional_salary_blockers(doc, employees):
	if not employees:
		return
	additional_salary = frappe.qb.DocType("Additional Salary")
	rows = (
		frappe.qb.from_(additional_salary)
		.select(additional_salary.employee, additional_salary.type, additional_salary.salary_component)
		.where(
			(additional_salary.employee.isin(list(employees)))
			& (additional_salary.docstatus == 1)
			& (additional_salary.disabled == 0)
			& (additional_salary.overwrite_salary_structure_amount == 1)
			& (
				(
					(additional_salary.is_recurring == 1)
					& (additional_salary.from_date <= doc.end_date)
					& (additional_salary.to_date >= doc.end_date)
				)
				| (
					(additional_salary.is_recurring == 0)
					& (additional_salary.payroll_date[doc.start_date : doc.end_date])
				)
			)
		)
	).run(as_dict=True)
	counts = defaultdict(int)
	for row in rows:
		counts[(row.employee, row.type, row.salary_component)] += 1
	for (name, _type, component), count in sorted(counts.items()):
		if count > 1:
			yield name, _("More than one Additional Salary overwrites {0} in this period").format(component)


def component_account_blockers(doc, assignments):
	structures = {row.salary_structure for row in assignments.values() if row}
	if not structures:
		return
	components = set(
		frappe.get_all(
			"Salary Detail",
			filters={"parenttype": "Salary Structure", "parent": ["in", list(structures)]},
			pluck="salary_component",
		)
	)
	if not components:
		return
	accounted = set(
		frappe.get_all(
			"Salary Component Account",
			filters={
				"parenttype": "Salary Component",
				"parent": ["in", list(components)],
				"company": doc.company,
				"account": ["is", "set"],
			},
			pluck="parent",
		)
	)
	for component in sorted(components - accounted):
		yield _("Salary Component {0} has no account for {1}").format(component, doc.company)


def cost_center_info(doc, employees, assignments):
	assignments = {name: row.name for name, row in assignments.items() if row}
	split = set(
		frappe.get_all(
			"Employee Cost Center",
			filters={
				"parenttype": "Salary Structure Assignment",
				"parent": ["in", list(assignments.values())],
			},
			pluck="parent",
		)
		if assignments
		else []
	)
	departments = {
		row.name: row.payroll_cost_center
		for row in frappe.get_all(
			"Department",
			filters={"name": ["in", list({e.department for e in employees.values() if e.department})]},
			fields=["name", "payroll_cost_center"],
		)
	}
	for name, employee in employees.items():
		if assignments.get(name) in split or employee.payroll_cost_center:
			continue
		if departments.get(employee.department):
			continue
		yield name, _("No payroll cost center, books to {0}").format(doc.cost_center)


def existing_slip_info(doc, employees):
	if not employees:
		return
	slips = frappe.get_all(
		"Salary Slip",
		filters={
			"employee": ["in", list(employees)],
			"docstatus": ["<", 2],
			"start_date": ["<=", doc.end_date],
			"end_date": [">=", doc.start_date],
		},
		fields=["name", "employee", "payroll_entry"],
		order_by="name asc",
	)
	for slip in slips:
		if doc.name and slip.payroll_entry == doc.name:
			continue
		yield slip.employee, _("Already has salary slip {0} in this period").format(slip.name)

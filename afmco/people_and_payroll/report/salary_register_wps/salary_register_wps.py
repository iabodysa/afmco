# Copyright (c) 2024, Frappe Technologies Pvt. Ltd. and contributors
# For license information, please see license.txt

# import frappe


# def execute(filters=None):
# 	columns, data = [], []
# 	return columns, data


# import frappe
# from frappe import _
# from frappe.utils import flt

# import erpnext


# def execute(filters=None):
# 	if not filters: filters = {}
# 	currency = None
# 	if filters.get('currency'):
# 		currency = filters.get('currency')
# 	company_currency = erpnext.get_company_currency(filters.get("company"))
# 	salary_slips = get_salary_slips(filters, company_currency)
# 	if not salary_slips: return [], []

# 	columns, earning_types, ded_types = get_columns(salary_slips)
# 	ss_earning_map = get_ss_earning_map(salary_slips, currency, company_currency)
# 	ss_ded_map = get_ss_ded_map(salary_slips,currency, company_currency)
# 	doj_map = get_employee_doj_map()
# 	iqama=get_employee_iqama()
# 	bank=get_employee_bank()
# 	account=get_employee_account()

# 	data = []
# 	for ss in salary_slips:
# 		row = [ss.employee, ss.employee_name,ss.branch,ss.designation,doj_map.get(ss.employee),
# 			iqama.get(ss.employee),bank.get(ss.employee),account.get(ss.employee)]

# 		if ss.branch is not None: columns[3] = columns[3].replace('-1','120')
# 		if ss.department is not None: columns[4] = columns[4].replace('-1','120')
# 		if ss.designation is not None: columns[5] = columns[5].replace('-1','120')
# 		if ss.leave_without_pay is not None: columns[9] = columns[9].replace('-1','130')


# 		for e in earning_types:
# 			row.append(ss_earning_map.get(ss.name, {}).get(e))

# 		if currency == company_currency:
# 			row += [flt(ss.gross_pay) * flt(ss.exchange_rate)]
# 		else:
# 			row += [ss.gross_pay]

# 		for d in ded_types:
# 			row.append(ss_ded_map.get(ss.name, {}).get(d))

# 		row.append(ss.total_loan_repayment)

# 		if currency == company_currency:
# 			row += [flt(ss.total_deduction) * flt(ss.exchange_rate), flt(ss.net_pay) * flt(ss.exchange_rate)]
# 		else:
# 			row += [ss.total_deduction, ss.net_pay]
# 		row.append(currency or company_currency)
# 		data.append(row)

# 	return columns, data

# def get_columns(salary_slips):
# 	"""
# 	columns = [
# 		_("Staff No") + ":Link/Employee:120",
# 		_("Employee Name") + "::140",
# 		_("Location") + ":Link/Branch:120",
# 		_("Position") + ":Link/Designation:120",
# 		_("Date of Joining") + "::100",
# 		_("Date of Joining") + "::100",
# 		_("ID Number") + "::100",
# 		_("Bank Name") + "::100",
# 		_("Account Number") + "::100",
# 	]
# 	"""
# 	columns = [
# 		_("Staff No") + ":Link/Employee:120",_("Employee Name") + "::140", _("Location") + ":Link/Branch:120",
# 		_("Postion") + ":Link/Designation:120",_("Date of Joining") + "::100",_("ID Number") + "::100",
# 		_("Bank Name") + "::100",_("Account Number") + "::100",
		
# 	]

# 	salary_components = {_("Earning"): [], _("Deduction"): []}

# 	for component in frappe.db.sql("""select distinct sd.salary_component, sc.type
# 		from `tabSalary Detail` sd, `tabSalary Component` sc
# 		where sc.name=sd.salary_component and sd.amount != 0 and sd.parent in (%s)""" %
# 		(', '.join(['%s']*len(salary_slips))), tuple([d.name for d in salary_slips]), as_dict=1):
# 		salary_components[_(component.type)].append(component.salary_component)

# 	columns = columns + [(e + ":Currency:120") for e in salary_components[_("Earning")]] + \
# 		[_("Gross Pay") + ":Currency:120"] + [(d + ":Currency:120") for d in salary_components[_("Deduction")]] + \
# 		[_("Loan Repayment") + ":Currency:120", _("Total Deduction") + ":Currency:120", _("Net Pay") + ":Currency:120"]

# 	return columns, salary_components[_("Earning")], salary_components[_("Deduction")]

# def get_salary_slips(filters, company_currency):
# 	filters.update({"from_date": filters.get("from_date"), "to_date":filters.get("to_date")})
# 	conditions, filters = get_conditions(filters, company_currency)
# 	salary_slips = frappe.db.sql("""select * from `tabSalary Slip` where %s
# 		order by employee""" % conditions, filters, as_dict=1)

# 	return salary_slips or []

# def get_conditions(filters, company_currency):
# 	conditions = ""
# 	doc_status = {"Draft": 0, "Submitted": 1, "Cancelled": 2}

# 	if filters.get("docstatus"):
# 		conditions += "docstatus = {0}".format(doc_status[filters.get("docstatus")])

# 	if filters.get("from_date"): conditions += " and start_date >= %(from_date)s"
# 	if filters.get("to_date"): conditions += " and end_date <= %(to_date)s"
# 	if filters.get("company"): conditions += " and company = %(company)s"
# 	if filters.get("employee"): conditions += " and employee = %(employee)s"
# 	if filters.get("currency") and filters.get("currency") != company_currency:
# 		conditions += " and currency = %(currency)s"

# 	return conditions, filters

# def get_employee_doj_map():
# 	return	frappe._dict(frappe.db.sql("""
# 				SELECT
# 					employee,
# 					date_of_joining
# 				FROM `tabEmployee`
# 				"""))

# def get_employee_iqama():
# 	return	frappe._dict(frappe.db.sql("""
# 				SELECT
# 					employee,
# 					employee_number
# 				FROM `tabEmployee`
# 				"""))
				
# def get_employee_bank():
# 	return	frappe._dict(frappe.db.sql("""
# 				SELECT
# 					employee,
# 					bank_name
# 				FROM `tabEmployee`
# 				"""))
# def get_employee_account():
# 	return	frappe._dict(frappe.db.sql("""
# 				SELECT
# 					employee,
# 					bank_ac_no
# 				FROM `tabEmployee`
# 				"""))
# def get_ss_earning_map(salary_slips, currency, company_currency):
# 	ss_earnings = frappe.db.sql("""select sd.parent, sd.salary_component, sd.amount, ss.exchange_rate, ss.name
# 		from `tabSalary Detail` sd, `tabSalary Slip` ss where sd.parent=ss.name and sd.parent in (%s)""" %
# 		(', '.join(['%s']*len(salary_slips))), tuple([d.name for d in salary_slips]), as_dict=1)

# 	ss_earning_map = {}
# 	for d in ss_earnings:
# 		ss_earning_map.setdefault(d.parent, frappe._dict()).setdefault(d.salary_component, 0.0)
# 		if currency == company_currency:
# 			ss_earning_map[d.parent][d.salary_component] += flt(d.amount) * flt(d.exchange_rate if d.exchange_rate else 1)
# 		else:
# 			ss_earning_map[d.parent][d.salary_component] += flt(d.amount)

# 	return ss_earning_map

# def get_ss_ded_map(salary_slips, currency, company_currency):
# 	ss_deductions = frappe.db.sql("""select sd.parent, sd.salary_component, sd.amount, ss.exchange_rate, ss.name
# 		from `tabSalary Detail` sd, `tabSalary Slip` ss where sd.parent=ss.name and sd.parent in (%s)""" %
# 		(', '.join(['%s']*len(salary_slips))), tuple([d.name for d in salary_slips]), as_dict=1)

# 	ss_ded_map = {}
# 	for d in ss_deductions:
# 		ss_ded_map.setdefault(d.parent, frappe._dict()).setdefault(d.salary_component, 0.0)
# 		if currency == company_currency:
# 			ss_ded_map[d.parent][d.salary_component] += flt(d.amount) * flt(d.exchange_rate if d.exchange_rate else 1)
# 		else:
# 			ss_ded_map[d.parent][d.salary_component] += flt(d.amount)

# 	return ss_ded_map

import frappe
from frappe import _
from frappe.utils import flt

import erpnext

salary_slip = frappe.qb.DocType("Salary Slip")
salary_detail = frappe.qb.DocType("Salary Detail")
salary_component = frappe.qb.DocType("Salary Component")


def execute(filters=None):
	if not filters:
		filters = {}

	currency = None
	if filters.get("currency"):
		currency = filters.get("currency")
	company_currency = erpnext.get_company_currency(filters.get("company"))

	salary_slips = get_salary_slips(filters, company_currency)
	if not salary_slips:
		return [], []

	earning_types, ded_types = get_earning_and_deduction_types(salary_slips)
	columns = get_columns(earning_types, ded_types)

	ss_earning_map = get_salary_slip_details(salary_slips, currency, company_currency, "earnings")
	ss_ded_map = get_salary_slip_details(salary_slips, currency, company_currency, "deductions")

	doj_map = get_employee_doj_map()

	data = []
	for ss in salary_slips:
		row = {
			"salary_slip_id": ss.name,
			"employee": ss.employee,
			"employee_name": ss.employee_name,
			"data_of_joining": doj_map.get(ss.employee),
			"bank_name": ss.bank_name,
			"bank_account_no":ss.bank_account_no,
			"custom_remark":ss.custom_remark,
			"branch": ss.branch,
			"department": ss.department,
			"designation": ss.designation,
			"company": ss.company,
			"start_date": ss.start_date,
			"end_date": ss.end_date,
			"leave_without_pay": ss.leave_without_pay,
			"payment_days": ss.payment_days,
			"custom_basic": ss.custom_basic,
			"custom_housing_gosi": ss.custom_housing_gosi,
			"custom_trinsportation": ss.custom_trinsportation,
			"custom_other_allowance": ss.custom_other_allowance,
			"custom_deductionss": ss.custom_deductionss,
			"currency": currency or company_currency,
			"total_loan_repayment": ss.total_loan_repayment,
		}

		update_column_width(ss, columns)

		for e in earning_types:
			row.update({frappe.scrub(e): ss_earning_map.get(ss.name, {}).get(e)})

		for d in ded_types:
			row.update({frappe.scrub(d): ss_ded_map.get(ss.name, {}).get(d)})

		if currency == company_currency:
			row.update(
				{
					"gross_pay": flt(ss.gross_pay) * flt(ss.exchange_rate),
					"total_deduction": flt(ss.total_deduction) * flt(ss.exchange_rate),
					"net_pay": flt(ss.net_pay) * flt(ss.exchange_rate),
				}
			)

		else:
			row.update(
				{"gross_pay": ss.gross_pay, "total_deduction": ss.total_deduction, "net_pay": ss.net_pay}
			)

		data.append(row)

	return columns, data


def get_earning_and_deduction_types(salary_slips):
	salary_component_and_type = {_("Earning"): [], _("Deduction"): []}

	for salary_compoent in get_salary_components(salary_slips):
		component_type = get_salary_component_type(salary_compoent)
		salary_component_and_type[_(component_type)].append(salary_compoent)

	return sorted(salary_component_and_type[_("Earning")]), sorted(salary_component_and_type[_("Deduction")])


def update_column_width(ss, columns):
	if ss.branch is not None:
		columns[3].update({"width": 120})
	if ss.bank_name is not None:
		columns[3].update({"width": 120})	
	if ss.department is not None:
		columns[4].update({"width": 120})
	if ss.designation is not None:
		columns[5].update({"width": 120})
	if ss.leave_without_pay is not None:
		columns[9].update({"width": 120})


def get_columns(earning_types, ded_types):
	columns = [
		{
			"label": _("Salary Slip ID"),
			"fieldname": "salary_slip_id",
			"fieldtype": "Link",
			"options": "Salary Slip",
			"width": 150,
		},
		{
			"label": _("Employee"),
			"fieldname": "employee",
			"fieldtype": "Link",
			"options": "Employee",
			"width": 120,
		},
		{
			"label": _("Employee Name"),
			"fieldname": "employee_name",
			"fieldtype": "Data",
			"width": 140,
		},
		{
			"label": _("Date of Joining"),
			"fieldname": "data_of_joining",
			"fieldtype": "Date",
			"width": 80,
		},
		{
			"label": _("Bank"),
			"fieldname": "bank_name",
			"fieldtype": "Data",
			"width": 80,
		},
		{
			"label": _("Remark"),
			"fieldname": "custom_remark",
			"fieldtype": "Small Text",
			"width": 80,
		},
		{
			"label": _("IBAN"),
			"fieldname": "bank_account_no",
			"fieldtype": "Data",
			"width": 80,
		},
		{
			"label": _("Branch"),
			"fieldname": "branch",
			"fieldtype": "Link",
			"options": "Branch",
			"width": -1,
		},
		{
			"label": _("Department"),
			"fieldname": "department",
			"fieldtype": "Link",
			"options": "Department",
			"width": -1,
		},
		{
			"label": _("Designation"),
			"fieldname": "designation",
			"fieldtype": "Link",
			"options": "Designation",
			"width": 120,
		},
		{
			"label": _("Company"),
			"fieldname": "company",
			"fieldtype": "Link",
			"options": "Company",
			"width": 120,
		},
		{
			"label": _("Start Date"),
			"fieldname": "start_date",
			"fieldtype": "Data",
			"width": 80,
		},
		{
			"label": _("End Date"),
			"fieldname": "end_date",
			"fieldtype": "Data",
			"width": 80,
		},
		{
			"label": _("Leave Without Pay"),
			"fieldname": "leave_without_pay",
			"fieldtype": "Float",
			"width": 50,
		},
		{
			"label": _("Payment Days"),
			"fieldname": "payment_days",
			"fieldtype": "Float",
			"width": 120,
		},
		{
			"label": _("Basic"),
			"fieldname": "custom_basic",
			"fieldtype": "Float",
			"width": 120,
		},
		{
			"label": _("Trinsportation"),
			"fieldname": "custom_housing_gosi",
			"fieldtype": "Float",
			"width": 120,
		},
		{
			"label": _("Housing"),
			"fieldname": "custom_housing_gosi",
			"fieldtype": "Float",
			"width": 120,
		},
		{
			"label": _("Other Allowances"),
			"fieldname": "custom_other_allowance",
			"fieldtype": "Float",
			"width": 120,
		},
		{
			"label": _("Deduction"),
			"fieldname": "custom_deductionss",
			"fieldtype": "Float",
			"width": 120,
		},
		
	]

	for earning in earning_types:
		columns.append(
			{
				"label": earning,
				"fieldname": frappe.scrub(earning),
				"fieldtype": "Currency",
				"options": "currency",
				"width": 120,
			}
		)

	columns.append(
		{
			"label": _("Gross Pay"),
			"fieldname": "gross_pay",
			"fieldtype": "Currency",
			"options": "currency",
			"width": 120,
		}
	)

	for deduction in ded_types:
		columns.append(
			{
				"label": deduction,
				"fieldname": frappe.scrub(deduction),
				"fieldtype": "Currency",
				"options": "currency",
				"width": 120,
			}
		)

	columns.extend(
		[
			{
				"label": _("Loan Repayment"),
				"fieldname": "total_loan_repayment",
				"fieldtype": "Currency",
				"options": "currency",
				"width": 120,
			},
			{
				"label": _("Total Deduction"),
				"fieldname": "total_deduction",
				"fieldtype": "Currency",
				"options": "currency",
				"width": 120,
			},
			{
				"label": _("Net Pay"),
				"fieldname": "net_pay",
				"fieldtype": "Currency",
				"options": "currency",
				"width": 120,
			},
			{
				"label": _("Currency"),
				"fieldtype": "Data",
				"fieldname": "currency",
				"options": "Currency",
				"hidden": 1,
			},
		]
	)
	return columns


def get_salary_components(salary_slips):
	return (
		frappe.qb.from_(salary_detail)
		.where((salary_detail.amount != 0) & (salary_detail.parent.isin([d.name for d in salary_slips])))
		.select(salary_detail.salary_component)
		.distinct()
	).run(pluck=True)


def get_salary_component_type(salary_component):
	return frappe.db.get_value("Salary Component", salary_component, "type", cache=True)


def get_salary_slips(filters, company_currency):
	doc_status = {"Draft": 0, "Submitted": 1, "Cancelled": 2}

	query = frappe.qb.from_(salary_slip).select(salary_slip.star)

	if filters.get("docstatus"):
		query = query.where(salary_slip.docstatus == doc_status[filters.get("docstatus")])

	if filters.get("from_date"):
		query = query.where(salary_slip.start_date >= filters.get("from_date"))

	if filters.get("to_date"):
		query = query.where(salary_slip.end_date <= filters.get("to_date"))

	if filters.get("company"):
		query = query.where(salary_slip.company == filters.get("company"))

	if filters.get("employee"):
		query = query.where(salary_slip.employee == filters.get("employee"))

	if filters.get("currency") and filters.get("currency") != company_currency:
		query = query.where(salary_slip.currency == filters.get("currency"))

	salary_slips = query.run(as_dict=1)

	return salary_slips or []


def get_employee_doj_map():
	employee = frappe.qb.DocType("Employee")

	result = (frappe.qb.from_(employee).select(employee.name, employee.date_of_joining)).run()

	return frappe._dict(result)


def get_salary_slip_details(salary_slips, currency, company_currency, component_type):
	salary_slips = [ss.name for ss in salary_slips]

	result = (
		frappe.qb.from_(salary_slip)
		.join(salary_detail)
		.on(salary_slip.name == salary_detail.parent)
		.where((salary_detail.parent.isin(salary_slips)) & (salary_detail.parentfield == component_type))
		.select(
			salary_detail.parent,
			salary_detail.salary_component,
			salary_detail.amount,
			salary_slip.exchange_rate,
		)
	).run(as_dict=1)

	ss_map = {}

	for d in result:
		ss_map.setdefault(d.parent, frappe._dict()).setdefault(d.salary_component, 0.0)
		if currency == company_currency:
			ss_map[d.parent][d.salary_component] += flt(d.amount) * flt(
				d.exchange_rate if d.exchange_rate else 1
			)
		else:
			ss_map[d.parent][d.salary_component] += flt(d.amount)

	return ss_map

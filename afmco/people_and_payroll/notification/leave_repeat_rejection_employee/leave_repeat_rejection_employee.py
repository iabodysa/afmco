# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from hrms.utils import get_employee_email


def get_context(context):
	return {"employee_email": get_employee_email(context["doc"].employee)}

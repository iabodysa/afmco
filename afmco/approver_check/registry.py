# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from afmco.approver_check import checks_leave, checks_payment, checks_settlement
from afmco.approver_check.model import PAYMENT_REQUISITION
from afmco.people_and_payroll.advance_leave_salary import ADVANCE_LEAVE_SALARY, END_OF_SERVICE

REGISTRY = {
	PAYMENT_REQUISITION: checks_payment.CHECKS,
	ADVANCE_LEAVE_SALARY: checks_leave.CHECKS,
	END_OF_SERVICE: checks_settlement.CHECKS,
}

ROLE_RESTRICTED = dict(checks_payment.ROLE_RESTRICTED)

APPROVER_STATES = {
	PAYMENT_REQUISITION: checks_payment.APPROVAL_STEPS,
	ADVANCE_LEAVE_SALARY: ("Waiting Accountant Approval", "Waiting Manager Approval", "Approved"),
	END_OF_SERVICE: ("Waiting Accountant Approval", "Waiting Manager Approval", "Legal", "Approved"),
}

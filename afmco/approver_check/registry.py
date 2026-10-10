# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from afmco.people_and_payroll.advance_leave_salary import END_OF_SERVICE

PAYMENT_REQUISITION = "Payment Requisition"

APPROVER_STATES = {
	PAYMENT_REQUISITION: ("Waiting P.M Approval", "Waiting Manager Approval"),
	END_OF_SERVICE: ("Waiting Manager Approval",),
}

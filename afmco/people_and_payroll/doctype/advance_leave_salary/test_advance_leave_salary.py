# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest.mock import patch

import frappe
from frappe.model.meta import Meta
from frappe.tests import IntegrationTestCase
from frappe.utils import getdate

from afmco.people_and_payroll.api.advance_leave_salary import (
    create_advance_leave_salary,
    fill_leave_allowance,
)

IGNORE_TEST_RECORD_DEPENDENCIES = ["Branch", "Department", "Employee"]

SETTLED_YEAR = ("2024-10-16", "2025-10-16")
TOUCHING_YEAR = ("2025-10-16", "2026-10-15")
EARLY_YEARS = (("2022-10-16", "2023-10-15"), ("2023-10-16", "2024-10-15"))


def period(dates, amount, status="unpaid"):
    return {
        "contract_start_date": dates[0],
        "contract_end_date": dates[1],
        "status": status,
        "amount3": amount,
    }


def stored_record(doctype, **values):
    doc = frappe.get_doc({"doctype": doctype, "name": f"_T-{frappe.generate_hash(length=10)}", **values})
    doc.db_insert()
    return doc


def make_employee(first_name):
    return stored_record(
        "Employee",
        first_name=first_name,
        employee_name=first_name,
        status="Active",
        date_of_joining="2022-10-16",
        basic_wage=1700,
    ).name


def leave_document(doctype, employee, rows, **values):
    return frappe.get_doc(
        {
            "doctype": doctype,
            "employee": employee,
            "date_1": "2022-10-16",
            "date_2": "2025-10-16",
            "total_salary": 1700,
            "vacation_days_per_year": "21",
            "cva": rows,
            **values,
        }
    ).insert()


class LeaveAllowanceCase(IntegrationTestCase):
    @classmethod
    def setUpClass(cls):
        for doctype, name, values in (
            ("Gender", "Male", {"gender": "Male"}),
            ("Warehouse Type", "Transit", {"name": "Transit"}),
            (
                "Holiday List",
                "Friday",
                {
                    "holiday_list_name": "Friday",
                    "from_date": "2013-01-01",
                    "to_date": "2030-12-31",
                },
            ),
            ("Workflow State", "Approved", {"workflow_state_name": "Approved"}),
            ("Workflow State", "Paid", {"workflow_state_name": "Paid"}),
            ("Workflow State", "Cancelled", {"workflow_state_name": "Cancelled"}),
        ):
            if not frappe.db.exists(doctype, name):
                frappe.get_doc({"doctype": doctype, **values}).insert()
        cls.enterClassContext(patch.object(Meta, "get_workflow", return_value=None))
        super().setUpClass()

    def settled(self, employee):
        return leave_document(
            "Advance Leave Salary",
            employee,
            [period(SETTLED_YEAR, 1190)],
            workflow_state="Paid",
        )


class TestAdvanceLeaveSalaryLeaveAllowance(LeaveAllowanceCase):
    doctype = "Advance Leave Salary"

    def test_saved_totals_are_recomputed_from_rows(self):
        doc = leave_document(
            self.doctype,
            make_employee("_T-ALS-Totals"),
            [period(SETTLED_YEAR, 1190), period(TOUCHING_YEAR, 500, "Paid")],
            cva_total=1,
            amount=1,
        )
        doc.reload()
        self.assertEqual((doc.cva_total, doc.amount), (1190, 1190))

    def test_submit_with_unpaid_row_repeating_paid_period_is_refused(self):
        employee = make_employee("_T-ALS-Submit")
        self.settled(employee)
        doc = leave_document(self.doctype, employee, [period(SETTLED_YEAR, 1190)])
        with self.assertRaises(frappe.ValidationError):
            doc.submit()

    def test_submit_with_row_touching_paid_period_passes(self):
        employee = make_employee("_T-ALS-Touch")
        self.settled(employee)
        doc = leave_document(self.doctype, employee, [period(TOUCHING_YEAR, 1190)])
        doc.submit()
        self.assertEqual(doc.docstatus, 1)

    def test_fill_for_early_joiner_without_paid_advance_is_refused(self):
        doc = leave_document(self.doctype, make_employee("_T-ALS-Gate"), [])
        with self.assertRaises(frappe.ValidationError):
            fill_leave_allowance(self.doctype, doc.name)

    def test_fill_keeps_rows_marked_paid_by_hand(self):
        employee = make_employee("_T-ALS-HandPaid")
        self.settled(employee)
        doc = leave_document(
            self.doctype, employee, [period(dates, 1190, "Paid") for dates in EARLY_YEARS]
        )
        fill_leave_allowance(self.doctype, doc.name)
        doc.reload()
        self.assertEqual(([row.status for row in doc.cva], doc.cva_total), (["Paid"] * 3, 0))

    def test_period_paid_by_payment_requisition_of_cancelled_request_is_refused_again(self):
        employee = make_employee("_T-ALS-PaidPR")
        cancelled = leave_document(
            self.doctype, employee, [period(SETTLED_YEAR, 1190)], workflow_state="Cancelled"
        )
        stored_record(
            "Payment Requisition",
            tax_invoice_number=cancelled.name,
            payment_type=self.doctype,
            docstatus=1,
            workflow_state="Paid",
        )
        doc = leave_document(self.doctype, employee, [period(SETTLED_YEAR, 1190)])
        with self.assertRaises(frappe.ValidationError):
            doc.submit()

    def test_employee_with_open_settlement_is_refused_advance_leave_salary(self):
        employee = make_employee("_T-ALS-Settled")
        stored_record(
            "End of Service Settlement", employee=employee, docstatus=1, workflow_state="Approved"
        )
        with self.assertRaises(frappe.ValidationError):
            create_advance_leave_salary(employee, "2025-10-16")

    def test_employee_with_cancelled_settlement_gets_advance_leave_salary(self):
        employee = make_employee("_T-ALS-Eligible")
        stored_record(
            "End of Service Settlement", employee=employee, docstatus=2, workflow_state="Cancelled"
        )
        name = create_advance_leave_salary(employee, "2025-10-16", 1)
        self.assertEqual(
            frappe.db.get_value(self.doctype, name, ["employee", "date_2", "check1"]),
            (employee, getdate("2025-10-16"), 1),
        )

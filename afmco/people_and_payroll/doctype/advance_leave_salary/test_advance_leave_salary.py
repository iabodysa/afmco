# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe.tests import IntegrationTestCase

from afmco.people_and_payroll.api.test_employee_form_api import make_employee
from afmco.people_and_payroll.api.advance_leave_salary import fill_leave_allowance

IGNORE_TEST_RECORD_DEPENDENCIES = ["Department", "Employee"]

SETTLED_YEAR = ("2024-10-16", "2025-10-16")
TOUCHING_YEAR = ("2025-10-16", "2026-10-15")


def period(dates, amount, status="unpaid"):
    return {
        "contract_start_date": dates[0],
        "contract_end_date": dates[1],
        "status": status,
        "amount3": amount,
    }


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
        ):
            if not frappe.db.exists(doctype, name):
                frappe.get_doc({"doctype": doctype, **values}).insert()
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

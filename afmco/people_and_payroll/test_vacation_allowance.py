# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import frappe

from afmco.people_and_payroll import vacation_allowance as va
from afmco.people_and_payroll.doctype.advance_leave_salary.advance_leave_salary import (
    AdvanceLeaveSalary,
)
from afmco.people_and_payroll.doctype.end_of_service_settlement.end_of_service_settlement import (
    EndofServiceSettlement,
)

THREE_YEARS = {
    "date_1": "2022-10-16",
    "date_2": "2025-10-16",
    "total_salary": 1700,
    "vacation_days_per_year": "21",
}
SETTLEMENT = {
    **THREE_YEARS,
    "end_of_service_reason": "1-End of term or mutual agreement",
    "ticket_allowance": 600,
    "term": "Final",
    "check1": 1,
    "penalty_clause": 0,
    "alternative_reward": None,
    "days_of_eos": None,
    "table_14": [{"amount2": 100}],
}
ADVANCE = {
    **THREE_YEARS,
    "alternative_reward": 50,
    "ticket_allowance": 600,
    "number_of_tickets": 1,
    "check1": 1,
    "not": 0,
}
SETTLED_YEAR = ("2024-10-16", "2025-10-16")
TOUCHING_YEAR = ("2025-10-16", "2026-10-15")


class Doc(frappe._dict):
    def set(self, key, value):
        self[key] = [frappe._dict(idx=i + 1, **row) for i, row in enumerate(value)]


def make(doctype, values, rows=()):
    doc = Doc(values, doctype=doctype, name="NEW-1", employee="EMP-1")
    doc.table_14 = [frappe._dict(row) for row in values.get("table_14", [])]
    doc.set("cva", rows)
    return doc


class Ledger:
    def __init__(self, joined="2024-01-01", clearance=None, settled=(), slips=()):
        self.employee = {
            "date_of_joining": joined,
            "date_of_last_vacation_clearance": clearance,
        }
        self.settled = settled
        self.slips = slips

    def get_all(self, doctype, filters=None, fields=None, pluck=None, **kwargs):
        if doctype in (va.ADVANCE_LEAVE_SALARY, va.END_OF_SERVICE):
            states = filters["workflow_state"][1]
            return [
                name
                for name, dt, state, _ in self.settled
                if dt == doctype and state in states
            ]
        if doctype == va.PERIOD_DOCTYPE:
            parents = filters["parent"][1]
            return [
                frappe._dict(contract_start_date=period[0], contract_end_date=period[1])
                for name, dt, _, period in self.settled
                if name in parents and dt == filters["parenttype"]
            ]
        return [
            frappe._dict(start_date=start, end_date=end) for start, end in self.slips
        ]

    def get_value(self, doctype, name, field):
        return self.employee[field]

    def exists(self, doctype, filters):
        return any(
            dt == doctype and state == filters["workflow_state"]
            for _, dt, state, _ in self.settled
        )


def monthly_slips(first, last):
    months = []
    month = frappe.utils.getdate(first)
    while month <= frappe.utils.getdate(last):
        months.append((month, frappe.utils.get_last_day(month)))
        month = frappe.utils.getdate(frappe.utils.add_months(month, 1))
    return months


def refuse(message, *args):
    raise frappe.ValidationError(message)


class LedgerCase(TestCase):
    def run_with(self, ledger, action, doc):
        with (
            patch.object(va, "_", lambda text: text),
            patch("frappe.get_all", side_effect=ledger.get_all),
            patch(
                "frappe.db",
                new=SimpleNamespace(get_value=ledger.get_value, exists=ledger.exists),
            ),
            patch("frappe.throw", side_effect=refuse),
        ):
            action(doc)
        return doc

    def filled(self, doctype, values, ledger):
        return self.run_with(ledger, va.fill_periods, make(doctype, values))


def rows_of(doc):
    return [
        (
            str(row.contract_start_date),
            str(row.contract_end_date),
            row.status,
            row.vad,
            row.amount3,
        )
        for row in doc.cva
    ]


ALL_SLIPS = monthly_slips("2022-10-01", "2025-10-01")


class TestFillPeriods(LedgerCase):
    def test_settlement_rows_run_yearly_from_first_to_last_day_with_364_day_amounts(
        self,
    ):
        doc = self.filled(va.END_OF_SERVICE, SETTLEMENT, Ledger(slips=ALL_SLIPS))
        self.assertEqual(
            rows_of(doc),
            [
                ("2022-10-16", "2023-10-16", "unpaid", "21", 1190),
                ("2023-10-17", "2024-10-15", "unpaid", "21", 1190),
                ("2024-10-16", "2025-10-16", "unpaid", "21", 1190),
            ],
        )
        self.assertEqual(
            (doc.cva_total, doc.amount, doc.total_eos), (3570, 6622, 2552.48)
        )

    def test_rows_from_sixth_year_use_30_vacation_days(self):
        values = {**SETTLEMENT, "date_1": "2013-03-05", "date_2": "2026-01-20"}
        doc = self.filled(
            va.END_OF_SERVICE,
            values,
            Ledger(slips=monthly_slips("2013-03-01", "2026-01-01")),
        )
        self.assertEqual([row.vad for row in doc.cva[4:7]], ["21", "30", "30"])

    def test_advance_period_repeating_approved_advance_period_is_filled_paid(self):
        ledger = Ledger(
            settled=[("VA-2025-00618", va.ADVANCE_LEAVE_SALARY, "Paid", SETTLED_YEAR)],
            slips=ALL_SLIPS,
        )
        doc = self.filled(va.ADVANCE_LEAVE_SALARY, ADVANCE, ledger)
        self.assertEqual([row.status for row in doc.cva], ["unpaid", "unpaid", "Paid"])
        self.assertEqual((doc.cva_total, doc.amount), (2380, 3030))

    def test_settlement_period_repeating_settled_period_is_filled_paid(self):
        ledger = Ledger(
            settled=[
                ("VA-2025-00618", va.ADVANCE_LEAVE_SALARY, "Approved", SETTLED_YEAR)
            ],
            slips=ALL_SLIPS,
        )
        doc = self.filled(va.END_OF_SERVICE, SETTLEMENT, ledger)
        self.assertEqual([row.status for row in doc.cva], ["unpaid", "unpaid", "Paid"])
        self.assertEqual((doc.cva_total, doc.amount), (2380, 5432))

    def test_period_touching_settled_period_on_boundary_day_stays_unpaid(self):
        ledger = Ledger(
            settled=[("VA-OLD", va.ADVANCE_LEAVE_SALARY, "Paid", TOUCHING_YEAR)],
            slips=ALL_SLIPS,
        )
        doc = self.filled(va.ADVANCE_LEAVE_SALARY, ADVANCE, ledger)
        self.assertEqual(
            [row.status for row in doc.cva], ["unpaid", "unpaid", "unpaid"]
        )

    def test_advance_periods_starting_on_or_before_last_clearance_are_paid_at_zero(
        self,
    ):
        doc = self.filled(
            va.ADVANCE_LEAVE_SALARY,
            ADVANCE,
            Ledger(clearance="2023-10-16", slips=ALL_SLIPS),
        )
        self.assertEqual(
            [(row.status, row.amount3) for row in doc.cva],
            [("Paid", 0), ("Paid", 0), ("unpaid", 1190)],
        )

    def test_employee_joined_before_cutoff_without_paid_advance_is_refused(self):
        with self.assertRaisesRegex(
            frappe.ValidationError, "no earlier Paid Advance Leave Salary"
        ):
            self.filled(
                va.ADVANCE_LEAVE_SALARY,
                ADVANCE,
                Ledger(joined="2020-01-01", slips=ALL_SLIPS),
            )

    def test_employee_joined_before_cutoff_with_paid_advance_is_filled(self):
        ledger = Ledger(
            joined="2020-01-01",
            settled=[("VA-OLD", va.ADVANCE_LEAVE_SALARY, "Paid", SETTLED_YEAR)],
            slips=ALL_SLIPS,
        )
        self.assertEqual(
            len(self.filled(va.ADVANCE_LEAVE_SALARY, ADVANCE, ledger).cva), 3
        )

    def test_month_without_submitted_salary_slip_is_refused(self):
        slips = [slip for slip in ALL_SLIPS if slip[0].strftime("%Y-%m") != "2025-03"]
        with self.assertRaisesRegex(
            frappe.ValidationError, "no submitted Salary Slip for 2025-03"
        ):
            self.filled(
                va.ADVANCE_LEAVE_SALARY,
                {**ADVANCE, "date_1": "2024-01-01"},
                Ledger(slips=slips),
            )

    def test_salary_slip_months_count_from_end_of_last_paid_period(self):
        ledger = Ledger(
            settled=[("VA-OLD", va.ADVANCE_LEAVE_SALARY, "Paid", SETTLED_YEAR)],
            slips=monthly_slips("2025-10-01", "2025-10-01"),
        )
        self.assertEqual(
            len(self.filled(va.ADVANCE_LEAVE_SALARY, ADVANCE, ledger).cva), 3
        )


class TestRecomputeAndSubmit(LedgerCase):
    def test_settlement_validate_recomputes_totals_from_rows(self):
        rows = [
            {"status": "unpaid", "amount3": 1190},
            {"status": "Paid", "amount3": 1190},
            {"status": "unpaid", "amount3": 1190.4},
        ]
        doc = make(va.END_OF_SERVICE, {**SETTLEMENT, "cva_total": 1, "amount": 1}, rows)
        va.recompute_settlement(doc)
        self.assertEqual((doc.cva_total, doc.amount), (2380, 5432))

    def test_advance_validate_recomputes_totals_from_rows(self):
        rows = [
            {"status": "unpaid", "amount3": 1190},
            {"status": "Paid", "amount3": 1190},
        ]
        doc = make(
            va.ADVANCE_LEAVE_SALARY,
            {**ADVANCE, "cva_total": 1, "amount": 1, "table_14": [{"amount2": 40}]},
            rows,
        )
        va.recompute_advance(doc)
        self.assertEqual((doc.cva_total, doc.deductions, doc.amount), (1190, 40, 1800))

    def test_submit_with_unpaid_row_overlapping_settled_period_is_refused(self):
        ledger = Ledger(
            settled=[("VA-OLD", va.ADVANCE_LEAVE_SALARY, "Approved", SETTLED_YEAR)]
        )
        for controller, doctype in (
            (AdvanceLeaveSalary, va.ADVANCE_LEAVE_SALARY),
            (EndofServiceSettlement, va.END_OF_SERVICE),
        ):
            doc = make(
                doctype,
                {},
                [
                    {
                        "contract_start_date": SETTLED_YEAR[0],
                        "contract_end_date": SETTLED_YEAR[1],
                        "status": "unpaid",
                    }
                ],
            )
            with self.assertRaisesRegex(frappe.ValidationError, "Row 1"):
                self.run_with(ledger, controller.before_submit, doc)

    def test_submit_with_settled_period_marked_paid_or_touching_passes(self):
        ledger = Ledger(
            settled=[("VA-OLD", va.ADVANCE_LEAVE_SALARY, "Approved", SETTLED_YEAR)]
        )
        rows = [
            {
                "contract_start_date": SETTLED_YEAR[0],
                "contract_end_date": SETTLED_YEAR[1],
                "status": "Paid",
            },
            {
                "contract_start_date": TOUCHING_YEAR[0],
                "contract_end_date": TOUCHING_YEAR[1],
                "status": "unpaid",
            },
        ]
        self.run_with(
            ledger,
            AdvanceLeaveSalary.before_submit,
            make(va.ADVANCE_LEAVE_SALARY, {}, rows),
        )

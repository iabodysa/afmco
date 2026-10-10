# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

import frappe

from afmco.people_and_payroll import advance_leave_salary
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
        if doctype in (advance_leave_salary.ADVANCE_LEAVE_SALARY, advance_leave_salary.END_OF_SERVICE):
            states = filters["workflow_state"][1]
            return [
                name
                for name, dt, state, _ in self.settled
                if dt == doctype and state in states
            ]
        if doctype == advance_leave_salary.PERIOD_DOCTYPE:
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
            patch.object(advance_leave_salary, "_", lambda text: text),
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
        return self.run_with(ledger, advance_leave_salary.fill_periods, make(doctype, values))


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
    def test_settlement_rows_run_from_each_anniversary_to_the_day_before_the_next(self):
        doc = self.filled(advance_leave_salary.END_OF_SERVICE, SETTLEMENT, Ledger(slips=ALL_SLIPS))
        self.assertEqual(
            rows_of(doc),
            [
                ("2022-10-16", "2023-10-15", "unpaid", "21", 1190),
                ("2023-10-16", "2024-10-15", "unpaid", "21", 1190),
                ("2024-10-16", "2025-10-15", "unpaid", "21", 1190),
            ],
        )
        self.assertEqual(
            (doc.cva_total, doc.amount, doc.total_eos), (3570, 6623, 2552.51)
        )

    def test_feb_29_joiner_rows_start_on_each_anniversary_and_first_year_ends_feb_27(self):
        doc = self.filled(
            advance_leave_salary.ADVANCE_LEAVE_SALARY,
            {**ADVANCE, "date_1": "2024-02-29", "date_2": "2027-02-27"},
            Ledger(slips=monthly_slips("2024-01-01", "2027-02-01")),
        )
        self.assertEqual(
            rows_of(doc),
            [
                ("2024-02-29", "2025-02-27", "unpaid", "21", 1190),
                ("2025-02-28", "2026-02-27", "unpaid", "21", 1190),
                ("2026-02-28", "2027-02-27", "unpaid", "21", 1190),
            ],
        )

    def test_partial_last_row_is_prorated_over_its_contract_year_days(self):
        doc = self.filled(
            advance_leave_salary.END_OF_SERVICE,
            {**SETTLEMENT, "date_1": "2023-03-01", "date_2": "2024-08-31"},
            Ledger(slips=monthly_slips("2023-03-01", "2024-08-01")),
        )
        self.assertEqual(
            rows_of(doc),
            [
                ("2023-03-01", "2024-02-29", "unpaid", "21", 1190),
                ("2024-03-01", "2024-08-31", "unpaid", "21", 600),
            ],
        )

    def test_rows_from_sixth_year_use_30_vacation_days(self):
        values = {**SETTLEMENT, "date_1": "2013-03-05", "date_2": "2026-01-20"}
        doc = self.filled(
            advance_leave_salary.END_OF_SERVICE,
            values,
            Ledger(slips=monthly_slips("2013-03-01", "2026-01-01")),
        )
        self.assertEqual([row.vad for row in doc.cva[4:7]], ["21", "30", "30"])

    def test_advance_period_repeating_approved_advance_period_is_filled_paid(self):
        ledger = Ledger(
            settled=[("VA-2025-00618", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Paid", SETTLED_YEAR)],
            slips=ALL_SLIPS,
        )
        doc = self.filled(advance_leave_salary.ADVANCE_LEAVE_SALARY, ADVANCE, ledger)
        self.assertEqual([row.status for row in doc.cva], ["unpaid", "unpaid", "Paid"])
        self.assertEqual((doc.cva_total, doc.amount), (2380, 3030))

    def test_settlement_period_repeating_settled_period_is_filled_paid(self):
        ledger = Ledger(
            settled=[
                ("VA-2025-00618", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Approved", SETTLED_YEAR)
            ],
            slips=ALL_SLIPS,
        )
        doc = self.filled(advance_leave_salary.END_OF_SERVICE, SETTLEMENT, ledger)
        self.assertEqual([row.status for row in doc.cva], ["unpaid", "unpaid", "Paid"])
        self.assertEqual((doc.cva_total, doc.amount), (2380, 5433))

    def test_period_touching_settled_period_on_boundary_day_stays_unpaid(self):
        ledger = Ledger(
            settled=[("VA-OLD", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Paid", TOUCHING_YEAR)],
            slips=ALL_SLIPS,
        )
        doc = self.filled(advance_leave_salary.ADVANCE_LEAVE_SALARY, ADVANCE, ledger)
        self.assertEqual(
            [row.status for row in doc.cva], ["unpaid", "unpaid", "unpaid"]
        )

    def test_advance_periods_starting_on_or_before_last_clearance_are_paid_at_zero_and_last_row_runs_to_date_2(
        self,
    ):
        doc = self.filled(
            advance_leave_salary.ADVANCE_LEAVE_SALARY,
            ADVANCE,
            Ledger(clearance="2023-10-16", slips=ALL_SLIPS),
        )
        self.assertEqual(
            [(row.status, row.amount3) for row in doc.cva],
            [("Paid", 0), ("Paid", 0), ("unpaid", 1193)],
        )

    def test_employee_joined_before_cutoff_without_paid_advance_is_refused(self):
        with self.assertRaisesRegex(
            frappe.ValidationError, "no earlier Paid Advance Leave Salary"
        ):
            self.filled(
                advance_leave_salary.ADVANCE_LEAVE_SALARY,
                ADVANCE,
                Ledger(joined="2020-01-01", slips=ALL_SLIPS),
            )

    def test_employee_joined_before_cutoff_with_paid_advance_is_filled(self):
        ledger = Ledger(
            joined="2020-01-01",
            settled=[("VA-OLD", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Paid", SETTLED_YEAR)],
            slips=ALL_SLIPS,
        )
        self.assertEqual(
            len(self.filled(advance_leave_salary.ADVANCE_LEAVE_SALARY, ADVANCE, ledger).cva), 3
        )

    def test_month_without_submitted_salary_slip_is_refused(self):
        slips = [slip for slip in ALL_SLIPS if slip[0].strftime("%Y-%m") != "2025-03"]
        with self.assertRaisesRegex(
            frappe.ValidationError, "no submitted Salary Slip for 2025-03"
        ):
            self.filled(
                advance_leave_salary.ADVANCE_LEAVE_SALARY,
                {**ADVANCE, "date_1": "2024-01-01"},
                Ledger(slips=slips),
            )

    def test_salary_slip_months_count_from_end_of_last_paid_period(self):
        ledger = Ledger(
            settled=[("VA-OLD", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Paid", SETTLED_YEAR)],
            slips=monthly_slips("2025-10-01", "2025-10-01"),
        )
        self.assertEqual(
            len(self.filled(advance_leave_salary.ADVANCE_LEAVE_SALARY, ADVANCE, ledger).cva), 3
        )


class TestRecomputeAndSubmit(LedgerCase):
    def test_settlement_validate_recomputes_totals_from_rows(self):
        rows = [
            {"status": "unpaid", "amount3": 1190},
            {"status": "Paid", "amount3": 1190},
            {"status": "unpaid", "amount3": 1190.4},
        ]
        doc = make(advance_leave_salary.END_OF_SERVICE, {**SETTLEMENT, "cva_total": 1, "amount": 1}, rows)
        advance_leave_salary.recompute_settlement(doc)
        self.assertEqual((doc.cva_total, doc.amount), (2380, 5433))

    def test_settlement_service_years_is_calendar_span_across_leap_days(self):
        doc = make(
            advance_leave_salary.END_OF_SERVICE,
            {**SETTLEMENT, "date_1": "2010-01-01", "date_2": "2025-12-31"},
        )
        advance_leave_salary.recompute_settlement(doc)
        self.assertEqual(doc.dos_years, "16.00")

    def test_duration_of_service_counts_the_last_working_day(self):
        year = {"date_1": "2025-01-01", "date_2": "2025-12-31"}
        settlement = make(advance_leave_salary.END_OF_SERVICE, {**SETTLEMENT, **year})
        advance = make(advance_leave_salary.ADVANCE_LEAVE_SALARY, {**ADVANCE, **year})
        advance_leave_salary.recompute_settlement(settlement)
        advance_leave_salary.recompute_advance(advance)
        self.assertEqual((settlement.duration_of_service, advance.duration_of_service), ("365.00", "365.00"))

    def test_advance_validate_recomputes_totals_from_rows(self):
        rows = [
            {"status": "unpaid", "amount3": 1190},
            {"status": "Paid", "amount3": 1190},
        ]
        doc = make(
            advance_leave_salary.ADVANCE_LEAVE_SALARY,
            {**ADVANCE, "cva_total": 1, "amount": 1, "table_14": [{"amount2": 40}]},
            rows,
        )
        advance_leave_salary.recompute_advance(doc)
        self.assertEqual((doc.cva_total, doc.deductions, doc.amount), (1190, 40, 1800))

    def test_submit_with_unpaid_row_overlapping_settled_period_is_refused(self):
        ledger = Ledger(
            settled=[("VA-OLD", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Approved", SETTLED_YEAR)]
        )
        for controller, doctype in (
            (AdvanceLeaveSalary, advance_leave_salary.ADVANCE_LEAVE_SALARY),
            (EndofServiceSettlement, advance_leave_salary.END_OF_SERVICE),
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
            settled=[("VA-OLD", advance_leave_salary.ADVANCE_LEAVE_SALARY, "Approved", SETTLED_YEAR)]
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
            make(advance_leave_salary.ADVANCE_LEAVE_SALARY, {}, rows),
        )


def approving(creation, rows, state="Approved"):
    doc = make(
        advance_leave_salary.ADVANCE_LEAVE_SALARY,
        {**ADVANCE, "date_1": "2025-04-01", "date_2": "2025-12-31", "creation": creation},
        rows,
    )
    doc.workflow_state = state
    doc.has_value_changed = lambda field: field == "workflow_state"
    return doc


OPEN_YEAR_ROW = {
    "contract_start_date": "2025-04-01",
    "contract_end_date": "2025-12-31",
    "status": "unpaid",
}


class TestApprovalLead(LedgerCase):
    def test_approval_passes_when_contract_year_ends_90_days_after_creation(self):
        self.run_with(Ledger(), AdvanceLeaveSalary.validate, approving("2026-01-01 09:00:00", [OPEN_YEAR_ROW]))

    def test_approval_refused_when_contract_year_ends_91_days_after_creation(self):
        with self.assertRaisesRegex(frappe.ValidationError, "Row 1 .* 2025-04-01 to 2026-03-31"):
            self.run_with(Ledger(), AdvanceLeaveSalary.validate, approving("2025-12-31 09:00:00", [OPEN_YEAR_ROW]))

    def test_paid_row_and_non_approval_transition_skip_the_lead_rule(self):
        self.run_with(
            Ledger(),
            AdvanceLeaveSalary.validate,
            approving("2025-06-01 09:00:00", [{**OPEN_YEAR_ROW, "status": "Paid"}]),
        )
        self.run_with(
            Ledger(),
            AdvanceLeaveSalary.validate,
            approving("2025-06-01 09:00:00", [OPEN_YEAR_ROW], state="Pending"),
        )


SEVEN = "7-Termination by the employee or termination of employment by the employee for reasons other than those specified in Article 81"
EIGHT = "8-Resignation"


def award(reason, service):
    return advance_leave_salary.settlement_days(reason, service, None)


class TestSettlementAward(TestCase):
    def test_resignation_outside_article_81_follows_article_85_tiers(self):
        self.assertAlmostEqual(award(SEVEN, 3), 15)
        self.assertAlmostEqual(award(SEVEN, 2), 10)

    def test_resignation_after_ten_years_uses_escalating_article_84_base(self):
        self.assertAlmostEqual(award(EIGHT, 12), 285)

    def test_resignation_of_exactly_ten_years_is_full_escalating_award(self):
        self.assertAlmostEqual(award(EIGHT, 10), 225)
        self.assertAlmostEqual(award(SEVEN, 10), 225)

    def test_resignation_boundaries_at_two_and_five_years(self):
        self.assertEqual(award(EIGHT, 1.99), 0)
        self.assertAlmostEqual(award(EIGHT, 2), 10)
        self.assertAlmostEqual(award(EIGHT, 5), 50)


class TestSalarySlipMonths(LedgerCase):
    def test_last_working_day_month_needs_no_salary_slip(self):
        slips = monthly_slips("2024-01-01", "2025-09-01")
        doc = self.filled(
            advance_leave_salary.ADVANCE_LEAVE_SALARY,
            {**ADVANCE, "date_1": "2024-01-01"},
            Ledger(slips=slips),
        )
        self.assertEqual(len(doc.cva), 2)

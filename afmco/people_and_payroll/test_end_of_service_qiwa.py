# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from unittest import TestCase, skip

import frappe
from frappe.utils import date_diff

from afmco.people_and_payroll import vacation_allowance as va

EXPIRATION = "1-End of term or mutual agreement"
RESIGNATION = "8-Resignation"
WAGE = 6000

QIWA_CASES = (
    ("C1", "2018-03-01", "2020-03-01", EXPIRATION, (2, 0, 1), 6008.33),
    ("C2", "2015-04-10", "2020-04-10", EXPIRATION, (5, 0, 1), 15016.67),
    ("C3", "2015-04-10", "2020-04-11", EXPIRATION, (5, 0, 2), 15033.33),
    ("C4", "2015-04-10", "2020-04-09", EXPIRATION, (5, 0, 0), 15000.00),
    ("C5", "2010-05-01", "2020-05-01", RESIGNATION, (10, 0, 1), 45016.67),
    ("C6", "2010-05-01", "2020-04-30", RESIGNATION, (10, 0, 0), 45000.00),
)

UNOBSERVED_CASES = (
    ("C7", "2022-01-15", "2022-02-15", EXPIRATION, 258.33),
    ("C8", "2022-01-01", "2022-01-16", EXPIRATION, 133.33),
    ("C9", "2000-01-01", "2020-01-01", EXPIRATION, 105016.67),
    ("C10", "2019-08-31", "2023-02-28", EXPIRATION, 10508.33),
)


def settle(start, end, reason):
    doc = frappe._dict(
        date_1=start,
        date_2=end,
        end_of_service_reason=reason,
        total_salary=WAGE,
        cva=[],
        days_of_eos=None,
    )
    va.recompute_settlement(doc)
    return doc


def continuous_days_award(start, end, reason):
    days = date_diff(end, start)
    if reason == RESIGNATION:
        eos_days = 75 + (days - 1825) / 365 * 30
    elif days <= 1826:
        eos_days = days / 365 * 15
    else:
        eos_days = va.js_round(75 + (days - 1825) * (30 / 365))
    return va.money(eos_days * WAGE / 30)


class TestQiwaCalendarMethod(TestCase):
    def test_settlement_total_equals_qiwa_reward_for_every_observed_case(self):
        for case, start, end, reason, _span, reward in QIWA_CASES:
            with self.subTest(case):
                self.assertEqual(settle(start, end, reason).total_eos, reward)

    def test_service_length_is_calendar_years_months_days_counting_end_date(self):
        for case, start, end, reason, span, _reward in QIWA_CASES:
            with self.subTest(case):
                doc = settle(start, end, reason)
                self.assertEqual(
                    (doc.years, doc.months, doc.days),
                    tuple(f"{part:.2f}" for part in span),
                )

    def test_resignation_one_day_short_of_ten_calendar_years_keeps_full_tier(self):
        self.assertEqual(settle("2010-05-01", "2020-04-30", RESIGNATION).total_eos, 45000.00)

    def test_continuous_days_over_365_misses_qiwa(self):
        misses = [
            case
            for case, start, end, reason, _span, reward in QIWA_CASES
            if continuous_days_award(start, end, reason) != reward
        ]
        self.assertEqual(misses, ["C1", "C2", "C3", "C4", "C5", "C6"])


@skip("awaiting Qiwa calculator observation for C7-C10")
class TestQiwaUnobservedCases(TestCase):
    def test_settlement_total_equals_qiwa_reward_for_unobserved_case(self):
        for case, start, end, reason, reward in UNOBSERVED_CASES:
            with self.subTest(case):
                self.assertEqual(settle(start, end, reason).total_eos, reward)

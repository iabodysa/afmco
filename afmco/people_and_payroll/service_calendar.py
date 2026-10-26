# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from datetime import date, timedelta

import frappe
from dateutil.relativedelta import relativedelta
from frappe.utils import getdate

ONE_DAY = timedelta(days=1)
ADVANCE_WINDOW_DAYS = 90
RECORDS_START = date(2024, 1, 1)
DRAW, DEBIT, UNPAID, ABSENT = "draw", "debit", "unpaid", "absent"


def inclusive_days(start, end):
    return (getdate(end) - getdate(start)).days + 1


def overlap_days(start, end, other_start, other_end):
    return max(
        0,
        inclusive_days(
            max(getdate(start), getdate(other_start)),
            min(getdate(end), getdate(other_end)),
        ),
    )


def unpaid_days(start, end, unpaid):
    return sum(overlap_days(start, end, first, last) for first, last in unpaid)


def worked_days(start, end, unpaid=()):
    return inclusive_days(start, end) - unpaid_days(start, end, unpaid)


def service_span(start, last_working_day, unpaid=()):
    span = relativedelta(getdate(last_working_day) + ONE_DAY, getdate(start))
    years, months = span.years, span.months
    days = span.days - unpaid_days(start, last_working_day, unpaid)
    while days < 0:
        days += 30
        months -= 1
    while months < 0:
        months += 12
        years -= 1
    return (years, months, days) if years >= 0 else (0, 0, 0)


def service_years(years, months, days):
    return years + months / 12 + days / 360


def service_value(start, last_working_day, unpaid=()):
    return service_years(*service_span(start, last_working_day, unpaid))


def unpaid_leave(employee):
    types = frappe.get_all(
        "Leave Type",
        or_filters={"is_lwp": 1, "extends_contract_year": 1},
        pluck="name",
    )
    if not (employee and types):
        return []
    return [
        (getdate(row.from_date), getdate(row.to_date))
        for row in frappe.get_all(
            "Leave Application",
            filters={
                "employee": employee,
                "docstatus": 1,
                "status": "Approved",
                "leave_type": ["in", types],
            },
            fields=["from_date", "to_date"],
        )
    ]


def extended_end(start, nominal_end, unpaid):
    end = nominal_end
    while True:
        stretched = nominal_end + timedelta(days=unpaid_days(start, end, unpaid))
        if stretched == end:
            return end
        end = stretched


def contract_years(anchor, until, unpaid=()):
    anchor, until = getdate(anchor), getdate(until)
    shift = timedelta()
    k = 1
    while True:
        start = anchor + relativedelta(years=k - 1) + shift
        if start > until:
            return
        nominal_end = anchor + relativedelta(years=k) - ONE_DAY + shift
        end = extended_end(start, nominal_end, unpaid)
        shift += end - nominal_end
        yield k, start, end
        k += 1


def contract_year_of(anchor, day, unpaid=()):
    year = None
    for year in contract_years(anchor, day, unpaid):
        pass
    return year


def leave_days(entitlement, start, end, year_start, year_end, unpaid=()):
    return entitlement * worked_days(start, end, unpaid) / worked_days(year_start, year_end, unpaid)


def within_advance_window(request_date, contract_year_end):
    return inclusive_days(request_date, contract_year_end) <= ADVANCE_WINDOW_DAYS


def day_runs(days):
    runs = []
    for day in sorted(days):
        if runs and runs[-1][1] + ONE_DAY == day:
            runs[-1][1] = day
        else:
            runs.append([day, day])
    return [(first, last) for first, last in runs]


def leave_ledger(anchor, until, entitlement, days, taken=None, extend=True):
    anchor, until = getdate(anchor), getdate(until)
    years, unpaid, balance, shift, k = [], [], 0, timedelta(), 1
    start = anchor
    while start <= until:
        nominal_end = anchor + relativedelta(years=k) - ONE_DAY + shift
        end = nominal_end
        year = frappe._dict(
            k=k,
            start=start,
            entitlement=entitlement(k),
            credited_on=None,
            taken=0,
            used=0,
            leave=0,
            absent=0,
            unpaid=0,
        )
        day = start
        while day <= end:
            if not year.credited_on and within_advance_window(day, end):
                year.credited_on = day
                year.taken = 1 if taken and taken(k, start, end) else 0
                balance += 0 if year.taken else year.entitlement
            kind = days.get(day)
            year.leave += kind in (DRAW, UNPAID)
            year.absent += kind == ABSENT
            if kind == DEBIT or (kind == DRAW and balance >= 1):
                balance -= 1
                year.used += 1
            elif kind in (DRAW, UNPAID, ABSENT):
                year.unpaid += 1
                unpaid.append(day)
                if extend:
                    end += ONE_DAY
            day += ONE_DAY
        shift += end - nominal_end
        year.update(end=end, balance=balance)
        years.append(year)
        start = end + ONE_DAY
        k += 1
    return years, day_runs(unpaid)

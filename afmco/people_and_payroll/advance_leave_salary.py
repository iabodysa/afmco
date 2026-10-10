# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import math
from datetime import date, timedelta

import frappe
from dateutil.relativedelta import relativedelta
from frappe import _
from frappe.utils import (
    add_months,
    cint,
    cstr,
    date_diff,
    flt,
    get_first_day,
    get_last_day,
    getdate,
)

ADVANCE_LEAVE_SALARY = "Advance Leave Salary"
END_OF_SERVICE = "End of Service Settlement"
PERIOD_DOCTYPE = "Contract Vacation Allowance"
APPROVED = "Approved"
SETTLED_STATES = (APPROVED, "Paid")
PAID = "Paid"
APPROVAL_LEAD_DAYS = 90
UNPAID = "unpaid"
NEW_JOINER_FROM = date(2023, 11, 15)

NO_EOS_REASONS = {
    "3-Termination by the employer under Article 80",
}
FULL_EOS_REASONS = {
    "1-End of term or mutual agreement",
    "2-Termination by the employer",
    "4-Termination due to force majeure",
    "5-Termination of the contract by the female employee during the first six months of marriage or during the first three months of childbirth",
    "6-Termination by the employee under Article 81",
}
RESIGNATION_REASONS = {
    "7-Termination by the employee or termination of employment by the employee for reasons other than those specified in Article 81",
    "8-Resignation",
}


def js_round(value):
    return math.floor(value + 0.5)


def fixed(value):
    return f"{value:.2f}"


def money(value):
    return float(fixed(value))


def unpaid_allowance(doc):
    return sum(flt(row.amount3) for row in doc.cva or [] if row.status != PAID)


def total_deductions(doc):
    return sum(flt(row.amount2) for row in doc.get("table_14") or [] if row.amount2)


def service_span(start, end):
    span = relativedelta(getdate(end) + timedelta(days=1), getdate(start))
    return span.years, span.months, span.days


def service_years(years, months, days):
    return years + months / 12 + days / 360


def daily_wage(wage):
    return money(flt(wage) / 30)


def settlement_award(reason, start, end, per_day, stored=None):
    span = service_span(start, end)
    eos_days = settlement_days(reason, service_years(*span), stored)
    return span, eos_days, money(flt(eos_days) * flt(per_day))


def settlement_days(reason, service, stored):
    if reason in NO_EOS_REASONS:
        return 0
    full = service * 15 if service <= 5 else 75 + (service - 5) * 30
    if reason in FULL_EOS_REASONS:
        return full
    if reason in RESIGNATION_REASONS:
        if service < 2:
            return 0
        if service < 5:
            return full / 3
        if service < 10:
            return full * 2 / 3
        return full
    return stored


def recompute_settlement(doc):
    doc.salary_per_day = daily_wage(doc.total_salary)
    if not (doc.date_1 and doc.date_2):
        return
    days = date_diff(doc.date_2, doc.date_1)
    span, eos_days, total_eos = settlement_award(
        doc.end_of_service_reason,
        doc.date_1,
        doc.date_2,
        doc.salary_per_day,
        doc.days_of_eos,
    )
    deducted = total_deductions(doc)
    doc.years, doc.months, doc.days = (fixed(part) for part in span)
    ticket = (
        0
        if doc.term == "Transfer of sponsorship" and doc.check1 == 0
        else flt(doc.ticket_allowance)
    )
    allowance = js_round(unpaid_allowance(doc))
    doc.total_eos = total_eos
    doc.dos_years = fixed(service_years(*span))
    doc.duration_of_service = fixed(days + 1)
    if eos_days is not None:
        doc.days_of_eos = money(eos_days)
    doc.cva_total = money(allowance)
    doc.deductions = money(deducted)
    doc.amount = money(
        js_round(
            total_eos
            + allowance
            + flt(doc.alternative_reward)
            + ticket
            - deducted
            - flt(doc.penalty_clause)
        )
    )


def recompute_advance(doc):
    doc.salary_per_day = daily_wage(doc.total_salary)
    if not (doc.date_1 and doc.date_2):
        return
    days = date_diff(doc.date_2, doc.date_1)
    unpaid = unpaid_allowance(doc)
    deducted = total_deductions(doc)
    ticket = 0 if doc.get("not") == 1 or doc.check1 == 0 else flt(doc.ticket_allowance)
    doc.dos_years = fixed(js_round(days / 365))
    doc.duration_of_service = fixed(days + 1)
    doc.cva_total = money(unpaid)
    doc.deductions = money(deducted)
    doc.amount = money(
        unpaid
        + flt(doc.alternative_reward)
        + cint(doc.number_of_tickets) * ticket
        - deducted
    )


RECOMPUTE = {
    END_OF_SERVICE: recompute_settlement,
    ADVANCE_LEAVE_SALARY: recompute_advance,
}


def build_periods(doc):
    first = getdate(doc.date_1)
    last_day = getdate(doc.date_2)
    years = flt(doc.dos_years)
    rows = []
    j = 0
    while j < years:
        start = first + relativedelta(years=j)
        year_end = first + relativedelta(years=j + 1) - timedelta(days=1)
        period_end = min(year_end, last_day)
        days = (period_end - start).days + 1
        year_days = (year_end - start).days + 1
        vad = doc.vacation_days_per_year or 21
        if j + 1 >= 6 and flt(vad) < 30:
            vad = 30
        rows.append(
            {
                "contract_start_date": start,
                "contract_end_date": period_end,
                "status": UNPAID,
                "note": _("Add your notes here"),
                "vad": cstr(vad),
                "amount3": js_round(flt(doc.salary_per_day) * (days / year_days * flt(vad))),
            }
        )
        j += 1
    return rows


def settled_periods(doc):
    periods = []
    for doctype in (ADVANCE_LEAVE_SALARY, END_OF_SERVICE):
        names = frappe.get_all(
            doctype,
            filters={
                "employee": doc.employee,
                "name": ["!=", doc.name],
                "workflow_state": ["in", SETTLED_STATES],
            },
            pluck="name",
        )
        if names:
            periods += frappe.get_all(
                PERIOD_DOCTYPE,
                filters={
                    "parenttype": doctype,
                    "parentfield": "cva",
                    "parent": ["in", names],
                },
                fields=["contract_start_date", "contract_end_date"],
            )
    return periods


def overlaps(row, period):
    if not (
        row.contract_start_date
        and row.contract_end_date
        and period.contract_start_date
        and period.contract_end_date
    ):
        return False
    return (
        date_diff(period.contract_end_date, row.contract_start_date) > 0
        and date_diff(row.contract_end_date, period.contract_start_date) > 0
    )


def months_without_salary_slip(employee, anchor, last_day):
    first_month = get_first_day(anchor)
    slips = frappe.get_all(
        "Salary Slip",
        filters={
            "employee": employee,
            "docstatus": 1,
            "end_date": [">=", first_month],
            "start_date": ["<=", last_day],
        },
        fields=["start_date", "end_date"],
    )
    missing = []
    month = first_month
    while month < get_first_day(last_day):
        month_end = get_last_day(month)
        if not any(
            getdate(slip.start_date) <= month_end and getdate(slip.end_date) >= month
            for slip in slips
        ):
            missing.append(month.strftime("%Y-%m"))
        month = getdate(add_months(month, 1))
    return missing


def refuse_unsupported_fill(doc, rows):
    joined = getdate(frappe.db.get_value("Employee", doc.employee, "date_of_joining"))
    if joined < NEW_JOINER_FROM and not frappe.db.exists(
        ADVANCE_LEAVE_SALARY,
        {"employee": doc.employee, "name": ["!=", doc.name], "workflow_state": PAID},
    ):
        frappe.throw(
            _(
                "Leave allowance table not filled: the employee has no earlier Paid Advance Leave Salary and joined on {0}, before {1}. Fill the table by hand."
            ).format(joined.isoformat(), NEW_JOINER_FROM.isoformat())
        )
    paid_ends = [
        getdate(row["contract_end_date"]) for row in rows if row["status"] == PAID
    ]
    anchor = max(paid_ends) if paid_ends else joined
    missing = months_without_salary_slip(doc.employee, anchor, getdate(doc.date_2))
    if missing:
        frappe.throw(
            _(
                "Leave allowance table not filled: no submitted Salary Slip for {0}. Fill the table by hand."
            ).format(", ".join(missing))
        )


def fill_periods(doc):
    RECOMPUTE[doc.doctype](doc)
    rows = build_periods(doc)
    periods = settled_periods(doc)
    clearance = None
    if doc.doctype == ADVANCE_LEAVE_SALARY:
        clearance = frappe.db.get_value(
            "Employee", doc.employee, "date_of_last_vacation_clearance"
        )
    for row in rows:
        if any(overlaps(frappe._dict(row), period) for period in periods):
            row["status"] = PAID
        if clearance and getdate(row["contract_start_date"]) <= getdate(clearance):
            row.update(status=PAID, amount3=0)
    refuse_unsupported_fill(doc, rows)
    doc.set("cva", rows)
    RECOMPUTE[doc.doctype](doc)


def refuse_unpaid_settled_period(doc):
    periods = settled_periods(doc)
    for row in doc.cva or []:
        if row.status != PAID and any(overlaps(row, period) for period in periods):
            frappe.throw(
                _(
                    "Row {0} of the leave allowance table overlaps a paid leave period and must be Paid before submitting."
                ).format(row.idx)
            )


def refuse_unfinished_contract_year(doc):
    joined = getdate(doc.date_1)
    requested = getdate(doc.creation)
    for row in doc.cva or []:
        if row.status == PAID or not row.contract_end_date:
            continue
        year = relativedelta(getdate(row.contract_end_date), joined).years
        year_start = joined + relativedelta(years=year)
        year_end = joined + relativedelta(years=year + 1) - timedelta(days=1)
        if (year_end - requested).days + 1 > APPROVAL_LEAD_DAYS:
            frappe.throw(
                _(
                    "Row {0} of the leave allowance table falls in the contract year {1} to {2}, which ends more than 90 days after this request was created."
                ).format(row.idx, year_start.isoformat(), year_end.isoformat())
            )

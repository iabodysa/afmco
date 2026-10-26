# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import math
import frappe
from frappe import _
from frappe.utils import (
    cint,
    cstr,
    date_diff,
    flt,
    formatdate,
    getdate,
    today,
)

from afmco.people_and_payroll.service_calendar import (
    ABSENT,
    DEBIT,
    DRAW,
    ONE_DAY,
    RECORDS_START,
    UNPAID as UNPAID_DAY,
    contract_year_of,
    contract_years,
    inclusive_days,
    leave_days,
    leave_ledger,
    overlap_days,
    service_span,
    service_value,
    service_years,
    unpaid_days,
    unpaid_leave,
    within_advance_window,
    worked_days,
)

ADVANCE_LEAVE_SALARY = "Advance Leave Salary"
END_OF_SERVICE = "End of Service Settlement"
PERIOD_DOCTYPE = "Contract Vacation Allowance"
PAYMENT_REQUISITION = "Payment Requisition"
APPROVED = "Approved"
SETTLED_STATES = (APPROVED, "Paid")
PAID = "Paid"
UNPAID = "unpaid"
DRIFT_DAYS = 7
OTHER_CLAIM = "Other"
EXTEND = "Extend"
NO_EXTENSION = "No extension"
TAKEN = "Taken"
BALANCE = "Balance"
FRIDAY = 4

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


def daily_wage(wage):
    return money(flt(wage) / 30)


def contract_year_note(anchor, last_day, unpaid, used=None):
    lines = []
    for k, start, end in contract_years(anchor, last_day, unpaid):
        lines.append(
            _("Contract year {0}: from {1} to {2}").format(
                k, formatdate(start), formatdate(end)
            )
        )
        if used and used.get(k):
            lines.append(_("Leave balance used: {0} days").format(used[k]))
        for first, last in sorted(unpaid):
            days = overlap_days(start, end, first, last)
            if days:
                lines.append(
                    _(
                        "Unpaid leave from {0} to {1}: {2} days added to the contract year"
                    ).format(formatdate(first), formatdate(last), days)
                )
    return "\n".join(lines)


def settlement_award(reason, start, end, per_day, stored=None, unpaid=()):
    span = service_span(start, end, unpaid)
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
    unpaid = unpaid_leave(doc.employee)
    span, eos_days, total_eos = settlement_award(
        doc.end_of_service_reason,
        doc.date_1,
        doc.date_2,
        doc.salary_per_day,
        doc.days_of_eos,
        unpaid,
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
    doc.duration_of_service = fixed(worked_days(doc.date_1, doc.date_2, unpaid))
    doc.contract_year_note = leave_note(doc)
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
    leave = unpaid_leave(doc.employee)
    allowance = unpaid_allowance(doc)
    deducted = total_deductions(doc)
    ticket = 0 if doc.get("not") == 1 or doc.check1 == 0 else flt(doc.ticket_allowance)
    doc.dos_years = fixed(service_value(doc.date_1, doc.date_2, leave))
    doc.duration_of_service = fixed(worked_days(doc.date_1, doc.date_2, leave))
    doc.contract_year_note = leave_note(doc)
    doc.cva_total = money(allowance)
    doc.deductions = money(deducted)
    doc.amount = money(
        allowance
        + flt(doc.alternative_reward)
        + cint(doc.number_of_tickets) * ticket
        - deducted
    )


RECOMPUTE = {
    END_OF_SERVICE: recompute_settlement,
    ADVANCE_LEAVE_SALARY: recompute_advance,
}


def entitlement(doc, k):
    vad = doc.vacation_days_per_year or 21
    return 30 if k >= 6 and flt(vad) < 30 else vad


def leave_day_kinds(employee):
    kinds = {}
    for row in frappe.get_all(
        "Leave Type",
        fields=["name", "is_lwp", "extends_contract_year", "uses_leave_balance"],
    ):
        if row.is_lwp or row.extends_contract_year:
            kinds[row.name] = DRAW if row.uses_leave_balance else UNPAID_DAY
        elif row.uses_leave_balance:
            kinds[row.name] = DEBIT
        else:
            kinds[row.name] = None
    rank = {UNPAID_DAY: 3, DRAW: 2, DEBIT: 1, None: 0}
    days = {}
    for row in frappe.get_all(
        "Leave Application",
        filters={"employee": employee, "docstatus": 1, "status": APPROVED},
        fields=["leave_type", "from_date", "to_date"],
    ):
        kind = kinds.get(row.leave_type)
        day, last = getdate(row.from_date), getdate(row.to_date)
        while day <= last:
            if day not in days or rank[kind] > rank[days[day]]:
                days[day] = kind
            day += ONE_DAY
    for day in frappe.get_all(
        "Attendance",
        filters={"employee": employee, "docstatus": 1, "status": "Absent"},
        pluck="attendance_date",
    ):
        day = getdate(day)
        if day.weekday() != FRIDAY and day not in days:
            days[day] = ABSENT
    return {day: kind for day, kind in days.items() if kind}


def has_early_leave_records(employee):
    return bool(
        frappe.db.exists(
            "Leave Application",
            {
                "employee": employee,
                "docstatus": 1,
                "status": APPROVED,
                "from_date": ["<", RECORDS_START],
            },
        )
    )


def before_records(doc, choice):
    if (
        not doc.date_1
        or getdate(doc.date_1) >= RECORDS_START
        or has_early_leave_records(doc.employee)
    ):
        return None, set()
    periods = settled_periods(doc)
    clearance = frappe.db.get_value(
        "Employee", doc.employee, "date_of_last_vacation_clearance"
    )
    asked = set()

    def taken(k, start, end):
        if end >= RECORDS_START:
            return False
        year = frappe._dict(contract_start_date=start, contract_end_date=end)
        if (clearance and start <= getdate(clearance)) or any(
            settled_year(year, period) for period in periods
        ):
            return True
        asked.add(k)
        return choice == TAKEN

    return taken, asked


def balance_ledger(doc, before_2024=None, extend=True):
    choice = before_2024 or doc.get("before_2024_leave")
    key = (
        doc.employee,
        cstr(doc.date_1),
        cstr(doc.date_2),
        cstr(doc.vacation_days_per_year),
        choice,
        extend,
    )
    cache = doc.flags.leave_ledger or {}
    if key not in cache:
        taken, asked = before_records(doc, choice)
        years, unpaid = leave_ledger(
            doc.date_1,
            doc.date_2,
            lambda k: flt(entitlement(doc, k)),
            leave_day_kinds(doc.employee),
            taken,
            extend,
        )
        cache[key] = (years, unpaid, sorted(asked))
        doc.flags.leave_ledger = cache
    return cache[key]


def contract_year_unpaid(doc):
    if doc.get("leave_extension") == EXTEND:
        return balance_ledger(doc)[1]
    if doc.get("leave_extension") == NO_EXTENSION:
        return []
    return unpaid_leave(doc.employee)


def leave_note(doc):
    unpaid = contract_year_unpaid(doc)
    used = None
    if doc.get("leave_extension"):
        years = balance_ledger(doc, extend=doc.leave_extension == EXTEND)[0]
        used = {year.k: year.used for year in years}
    return contract_year_note(doc.date_1, doc.date_2, unpaid, used)


def build_periods(doc):
    last_day = getdate(doc.date_2)
    advance = doc.doctype == ADVANCE_LEAVE_SALARY
    unpaid = contract_year_unpaid(doc)
    rows = []
    for k, start, year_end in contract_years(doc.date_1, last_day, unpaid):
        if advance and year_end > last_day and not within_advance_window(getdate(doc.creation), year_end):
            break
        period_end = year_end if advance else min(year_end, last_day)
        vad = entitlement(doc, k)
        rows.append(
            {
                "contract_start_date": start,
                "contract_end_date": period_end,
                "status": UNPAID,
                "note": _("Add your notes here"),
                "vad": cstr(vad),
                "amount3": period_amount(doc, vad, start, period_end, start, year_end, unpaid),
            }
        )
    return rows


def period_amount(doc, vad, start, end, year_start, year_end, unpaid):
    return js_round(
        flt(doc.salary_per_day) * leave_days(flt(vad), start, end, year_start, year_end, unpaid)
    )


def row_amount(doc, row, unpaid):
    year = contract_year_of(doc.date_1, row.contract_start_date, unpaid)
    if not year:
        return 0
    k, year_start, year_end = year
    end = min(getdate(row.contract_end_date), year_end)
    return period_amount(
        doc, entitlement(doc, k), row.contract_start_date, end, year_start, year_end, unpaid
    )


def settled_names(doctype, doc, include_cancelled=True):
    records = frappe.get_all(
        doctype,
        filters={"employee": doc.employee, "name": ["!=", doc.name]},
        fields=["name", "workflow_state", "docstatus"],
    )
    if not records:
        return []
    paid = set(
        frappe.get_all(
            PAYMENT_REQUISITION,
            filters={
                "tax_invoice_number": ["in", [record.name for record in records]],
                "docstatus": 1,
                "workflow_state": PAID,
            },
            pluck="tax_invoice_number",
        )
    )
    return [
        record.name
        for record in records
        if record.name in paid
        or (
            record.workflow_state in SETTLED_STATES
            and (include_cancelled or record.docstatus < 2)
        )
    ]


def settled_periods(doc):
    periods = []
    for doctype in (ADVANCE_LEAVE_SALARY, END_OF_SERVICE):
        names = settled_names(doctype, doc)
        if names:
            periods += frappe.get_all(
                PERIOD_DOCTYPE,
                filters={
                    "parenttype": doctype,
                    "parentfield": "cva",
                    "parent": ["in", names],
                },
                fields=["parent", "contract_start_date", "contract_end_date", "status"],
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
    return shared_days(row, period) > 0


def shared_days(row, period):
    return overlap_days(
        row.contract_start_date,
        row.contract_end_date,
        period.contract_start_date,
        period.contract_end_date,
    )


def same_year(row, period):
    return (
        abs(date_diff(row.contract_start_date, period.contract_start_date)) <= DRIFT_DAYS
        and abs(date_diff(row.contract_end_date, period.contract_end_date)) <= DRIFT_DAYS
    )


def settled_year(row, period):
    return overlaps(row, period) and (
        same_year(row, period) or shared_days(row, period) > DRIFT_DAYS
    )


def leave_differences(names):
    return _("Leave differences settlement: {0}").format(names)


def overlap_deduction(doc, periods, unpaid):
    trusted = [
        row
        for row in doc.cva or []
        if row.status != PAID and any(settled_year(row, period) for period in periods)
    ]
    paid = [
        period
        for period in periods
        if period.status != PAID and not any(settled_year(row, period) for row in trusted)
    ]
    net = excess_days = excess_value = 0
    names = []
    for row in doc.cva or []:
        if any(row is choice for choice in trusted):
            continue
        covering = [period for period in paid if overlaps(row, period)]
        if not covering:
            continue
        covered = sum(shared_days(row, period) for period in covering)
        extra = covered
        if row.status == PAID:
            extra -= inclusive_days(row.contract_start_date, row.contract_end_date)
        net += extra
        if extra > 0:
            excess_days += extra
            excess_value += extra * row_amount(doc, row, unpaid) / inclusive_days(
                row.contract_start_date, row.contract_end_date
            )
            names += [period.parent for period in covering if period.parent not in names]
    if net <= 0:
        return None
    return {
        "claim_type": OTHER_CLAIM,
        "date": today(),
        "note": leave_differences(", ".join(names)),
        "amount2": js_round(net * excess_value / excess_days),
    }


def fill_periods(doc):
    RECOMPUTE[doc.doctype](doc)
    rows = build_periods(doc)
    periods = settled_periods(doc) + [row for row in doc.cva or [] if row.status == PAID]
    clearance = None
    if doc.doctype == ADVANCE_LEAVE_SALARY:
        clearance = frappe.db.get_value(
            "Employee", doc.employee, "date_of_last_vacation_clearance"
        )
    for row in rows:
        current = frappe._dict(row)
        if any(settled_year(current, period) for period in periods) or (
            clearance and getdate(row["contract_start_date"]) <= getdate(clearance)
        ):
            row.update(status=PAID, amount3=None)
    doc.set("cva", rows)
    refresh_deduction(doc, periods, contract_year_unpaid(doc))
    RECOMPUTE[doc.doctype](doc)


def refresh_deduction(doc, periods, unpaid):
    prefix = leave_differences("")
    deductions = [row for row in doc.get("table_14") or [] if not cstr(row.note).startswith(prefix)]
    line = overlap_deduction(doc, periods, unpaid)
    doc.set("table_14", deductions + ([line] if line else []))


def follow_status_switch(doc):
    before = doc.get_doc_before_save()
    if not before:
        return
    previous = {row.name: row.status for row in before.cva or []}
    switched = [row for row in doc.cva or [] if row.name in previous and previous[row.name] != row.status]
    if not switched:
        return
    unpaid = contract_year_unpaid(doc)
    for row in switched:
        row.amount3 = None if row.status == PAID else row_amount(doc, row, unpaid)
    refresh_deduction(doc, settled_periods(doc), unpaid)
    RECOMPUTE[doc.doctype](doc)


def refuse_settled_employee(doc):
    settlement = frappe.db.get_value(
        END_OF_SERVICE,
        {
            "employee": doc.employee,
            "docstatus": ["!=", 2],
            "workflow_state": ["not in", ["Cancelled"]],
        },
        "name",
    )
    if settlement:
        frappe.throw(
            _(
                "Employee {0} has End of Service Settlement {1}, so no Advance Leave Salary can be created for this employee."
            ).format(doc.employee, settlement)
        )


def refuse_unfinished_contract_year(doc):
    unpaid = contract_year_unpaid(doc)
    for row in doc.cva or []:
        if row.status == PAID or not (row.contract_start_date and row.contract_end_date):
            continue
        year = contract_year_of(doc.date_1, row.contract_start_date, unpaid)
        if not year:
            continue
        _k, year_start, year_end = year
        if not within_advance_window(getdate(doc.creation), year_end):
            frappe.throw(
                _(
                    "Row {0} of the leave allowance table falls in the contract year {1} to {2}, which ends more than 90 days after this request was created."
                ).format(row.idx, year_start.isoformat(), year_end.isoformat())
            )


def refuse_unearned_rows(doc):
    if not doc.date_1:
        return
    unpaid = contract_year_unpaid(doc)
    for row in doc.cva or []:
        if row.status == PAID or not (row.contract_start_date and row.contract_end_date):
            continue
        year = contract_year_of(doc.date_1, row.contract_start_date, unpaid)
        if not year:
            continue
        k, year_start, year_end = year
        start, end = getdate(row.contract_start_date), getdate(row.contract_end_date)
        last_day = year_end if unpaid_days(year_start, year_end, unpaid) else year_end + ONE_DAY
        earned = flt(
            leave_days(flt(entitlement(doc, k)), year_start, min(end, year_end), year_start, year_end, unpaid), 2
        )
        if end > last_day or flt(row.vad) > earned:
            frappe.throw(
                _(
                    "Leave allowance row {0} asks for {1} days from {2} to {3}, but contract year {4} runs from {5} to {6} and this period earns {7} days. Match the row dates to the contract year."
                ).format(
                    row.idx,
                    f"{flt(row.vad):g}",
                    formatdate(start),
                    formatdate(end),
                    k,
                    formatdate(year_start),
                    formatdate(year_end),
                    f"{earned:g}",
                )
            )

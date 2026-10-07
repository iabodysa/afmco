from __future__ import annotations

from collections.abc import Callable, Iterable

import frappe
from frappe.model.document import Document


class IqamaRenewalFeeTracking(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.calculate_renewal_fees()

	def calculate_renewal_fees(self):
		if self.get('renewal_preference') == "Yes":
			renewal_fees = {3: 163, 6: 325, 9: 488, 12: 650}
			sadad_invoices = {3: 2425, 6: 4850, 9: 7275, 12: 9700}

			renewal_fee_amount = renewal_fees.get(self.get('renewal_period'), 0)
			sadad_invoice_amount = sadad_invoices.get(self.get('renewal_period'), 0)

			self.sadad_invoice_amount = sadad_invoice_amount
			self.renewal_fee_amount = renewal_fee_amount

			iqama_expiration_date = frappe.utils.getdate(self.get('iqama_expiration_date'))
			renewal_period_months = self.get('renewal_period')
			renewal_period_days = renewal_period_months * 30
			next_renewal_start_date = frappe.utils.add_days(iqama_expiration_date, 1)
			renewal_end_date = frappe.utils.add_days(next_renewal_start_date, renewal_period_days - 1)

			current_year_end_date = frappe.utils.get_last_day(frappe.utils.get_first_day(iqama_expiration_date).replace(month=12))

			if renewal_end_date <= current_year_end_date:
				self.sadad_amount_this_year = sadad_invoice_amount
				self.sadad_advance_amount = 0
				self.renewal_fee_this_year = renewal_fee_amount
				self.renewal_advance_fee = 0
			else:
				days_in_current_year = (current_year_end_date - next_renewal_start_date).days + 1
				total_days = (renewal_end_date - next_renewal_start_date).days + 1
				self.sadad_amount_this_year = (sadad_invoice_amount * days_in_current_year) / total_days
				self.sadad_advance_amount = sadad_invoice_amount - self.sadad_amount_this_year
				self.renewal_fee_this_year = (renewal_fee_amount * days_in_current_year) / total_days
				self.renewal_advance_fee = renewal_fee_amount - self.renewal_fee_this_year

			self.total_amount = (
				self.sadad_amount_this_year +
				self.sadad_advance_amount +
				self.renewal_fee_this_year +
				self.renewal_advance_fee
			)

			if any([
				self.get('issue_in_renewal') == 1,
				self.get('traffic_violations') == 1,
				self.get('two_year_plan') == 1,
				self.get('medical_insurance_issue') == 1,
				self.get('dependent_fees') == 1
			]):
				self.status = 'Issue Preventing Renewal'

		elif self.get('renewal_preference') == "NO":
			self.sadad_invoice_amount = 0
			self.sadad_amount_this_year = 0
			self.sadad_advance_amount = 0
			self.renewal_fee_amount = 0
			self.renewal_fee_this_year = 0
			self.renewal_advance_fee = 0
			self.total_amount = 0


EMPLOYEE_DOCTYPE = "Employee"
TRACKING_DOCTYPE = "Iqama Renewal Fee Tracking"
EXPIRY_HORIZON_DAYS = 60
DEDUPE_WINDOW_DAYS = -90
REFRESH_WINDOW_DAYS = -30
RENEWED_STATUS = "Renewed"


def _value(record, field: str):
    return record.get(field) if isinstance(record, dict) else getattr(record, field, None)


def employee_filters(today, horizon) -> list[list]:
    return [
        ["status", "=", "Active"],
        ["iqama_expiration_date", "<=", horizon],
        ["iqama_expiration_date", ">=", today],
        ["corporation", "is", "set"],
        ["iqama_expiration_date", "is", "set"],
    ]


def needs_new_tracking(recent_tracking: list) -> bool:
    return not recent_tracking


def tracking_values(employee) -> dict[str, object]:
    return {
        "doctype": TRACKING_DOCTYPE,
        "employee": _value(employee, "name"),
        "employee_name": _value(employee, "employee_name"),
        "department": _value(employee, "department"),
        "corporation": _value(employee, "corporation"),
        "iqama_expiration_date": _value(employee, "iqama_expiration_date"),
        "cost_center": _value(employee, "payroll_cost_center"),
    }


def needs_renewal_update(tracking, employee_expiry) -> bool:
    recorded = _value(tracking, "iqama_expiration_date")
    already_new = _value(tracking, "iqama_new_expiration_date")
    if recorded == employee_expiry:
        return False
    return not already_new or already_new != employee_expiry


def renewal_update(new_expiry) -> dict[str, object]:
    return {"iqama_new_expiration_date": new_expiry, "status": RENEWED_STATUS}


def process(items: Iterable, apply: Callable[[object], None]) -> dict[str, object]:
    updated = 0
    errors: list[str] = []
    for item in items:
        try:
            apply(item)
        except Exception as error:
            errors.append(f"{item}: {error}")
        else:
            updated += 1
    return {"updated": updated, "errors": errors}


def check_iqama_renewal_fee() -> dict[str, object]:
    import frappe

    today = frappe.utils.getdate(frappe.utils.nowdate())
    horizon = frappe.utils.add_days(today, EXPIRY_HORIZON_DAYS)
    dedupe_since = frappe.utils.add_days(today, DEDUPE_WINDOW_DAYS)
    refresh_since = frappe.utils.add_days(today, REFRESH_WINDOW_DAYS)

    employees = frappe.get_all(
        EMPLOYEE_DOCTYPE,
        filters=employee_filters(today, horizon),
        fields=[
            "name",
            "employee_name",
            "department",
            "corporation",
            "iqama_expiration_date",
            "payroll_cost_center",
        ],
    )

    def open_tracking(employee) -> None:
        existing = frappe.get_all(
            TRACKING_DOCTYPE,
            filters={"employee": employee["name"], "creation": [">", dedupe_since]},
            pluck="name",
            limit=1,
        )
        if needs_new_tracking(existing):
            frappe.get_doc(tracking_values(employee)).insert()

    opened = process(employees, open_tracking)

    recent = frappe.get_all(
        TRACKING_DOCTYPE,
        filters=[["creation", ">", refresh_since]],
        fields=["name", "employee", "iqama_expiration_date", "iqama_new_expiration_date"],
    )

    def close_tracking(tracking) -> None:
        employee_expiry = frappe.db.get_value(EMPLOYEE_DOCTYPE, tracking["employee"], "iqama_expiration_date")
        if not needs_renewal_update(tracking, employee_expiry):
            return
        document = frappe.get_doc(TRACKING_DOCTYPE, tracking["name"])
        for field, value in renewal_update(employee_expiry).items():
            setattr(document, field, value)
        document.save()

    closed = process(recent, close_tracking)

    errors = list(opened["errors"]) + list(closed["errors"])
    if errors:
        frappe.log_error(title="iQama renewal v2 task", message="\n".join(str(error) for error in errors))
    return {"opened": opened["updated"], "revisited": closed["updated"], "errors": errors}

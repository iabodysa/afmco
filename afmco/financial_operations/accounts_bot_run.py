# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import math

import frappe
from frappe import _
from frappe.desk.doctype.notification_log.notification_log import enqueue_create_notification
from frappe.utils import add_to_date, get_datetime

from afmco.financial_operations import accounts_bot_choice

PAYMENT_REQUISITION = accounts_bot_choice.PAYMENT_REQUISITION
DONE_EVENT = "accounts_bot_done"
SAMPLE_RUNS = 30
MIN_RUNS = 3
PERCENTILE = 0.75


def run_durations(payment_type: str | None = None) -> list[float]:
	filters = {
		"accounts_bot_status": ["in", accounts_bot_choice.FINISHED],
		"accounts_bot_read_receipt_cf": 0,
		"accounts_bot_updated": ["is", "set"],
	}
	if payment_type:
		filters["payment_type"] = payment_type
	runs = frappe.get_all(
		PAYMENT_REQUISITION,
		filters=filters,
		fields=["name", "accounts_bot_updated"],
		order_by="accounts_bot_updated desc",
		limit=SAMPLE_RUNS,
	)
	if not runs:
		return []
	presses = {}
	for version in frappe.get_all(
		"Version",
		filters={
			"ref_doctype": PAYMENT_REQUISITION,
			"docname": ["in", [run.name for run in runs]],
			"data": ["like", '%"accounts_bot_status"%'],
		},
		fields=["docname", "data", "creation"],
		order_by="creation asc",
	):
		if accounts_bot_choice.is_press(version):
			presses.setdefault(version.docname, []).append(get_datetime(version.creation))
	durations = []
	for run in runs:
		end = get_datetime(run.accounts_bot_updated)
		if starts := [start for start in presses.get(run.name, []) if start <= end]:
			durations.append((end - starts[-1]).total_seconds())
	return durations


def expected_finish(name: str, payment_type: str | None):
	press = accounts_bot_choice.last_press(name)
	if not press:
		return None
	durations = run_durations(payment_type) if payment_type else []
	if len(durations) < MIN_RUNS:
		durations = run_durations()
	if len(durations) < MIN_RUNS:
		return None
	ordered = sorted(durations)
	seconds = ordered[math.ceil(PERCENTILE * len(ordered)) - 1]
	return add_to_date(get_datetime(press.creation), seconds=seconds).replace(microsecond=0)


def announce_expected_finish(requisition) -> None:
	if finish := expected_finish(requisition.name, requisition.payment_type):
		frappe.msgprint(_("The Accounts Bot expects to finish by {0}.").format(finish.strftime("%H:%M")))


def announce_finish(name: str, status: str) -> None:
	user = accounts_bot_choice.presser(name)
	if not user:
		return
	created = status == accounts_bot_choice.JOURNAL_ENTRY_CREATED
	journal_entry = (
		frappe.db.get_value("Journal Entry", {"expense_request_cf": name}, "name", order_by="creation desc")
		if created
		else None
	)
	frappe.publish_realtime(
		DONE_EVENT,
		{"pr": name, "status": status, "journal_entry": journal_entry},
		user=user,
		after_commit=True,
	)
	subject = (
		_("The Accounts Bot created the Journal Entry for Payment Requisition {0}.")
		if created
		else _("The Accounts Bot stopped on Payment Requisition {0} and needs your review.")
	).format(name)
	if not (email := frappe.db.get_value("User", user, "email")):
		return
	enqueue_create_notification(
		email,
		{
			"type": "Alert",
			"document_type": PAYMENT_REQUISITION,
			"document_name": name,
			"subject": subject,
			"from_user": frappe.session.user,
		},
	)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import signal
import threading
from collections import Counter
from contextlib import contextmanager
from time import monotonic

import frappe
from frappe import _
from frappe.model.workflow import get_transitions, get_workflow_name
from frappe.utils import now

from afmco.approver_check.model import (
	BLOCK,
	CATEGORIES,
	EMPLOYEE,
	FAIL,
	NA,
	PAYMENT_REQUISITION,
	PENDING,
	STATUSES,
	TIMEOUT,
	UNKNOWN,
	Check,
	Context,
	Result,
	Unverifiable,
)
from afmco.approver_check.registry import APPROVER_STATES, REGISTRY, ROLE_RESTRICTED
from afmco.people_and_payroll.advance_leave_salary import ADVANCE_LEAVE_SALARY, END_OF_SERVICE

ENGINE_VERSION = "1"
AI_KEY = "afmco_approver_ai_key"
CHECK_SECONDS = 10
BACKGROUND_SECONDS = 120
RESULT_SECONDS = 86400
RESULT_EVENT = "afmco_approver_check_result"
SENSITIVE = (EMPLOYEE, ADVANCE_LEAVE_SALARY, END_OF_SERVICE, PAYMENT_REQUISITION, "IBAN Update")


class CheckTimeout(BaseException):
	pass


@contextmanager
def time_limit(seconds: float):
	if threading.current_thread() is not threading.main_thread():
		yield
		return
	outer = signal.getitimer(signal.ITIMER_REAL)[0]
	if outer and outer <= seconds:
		yield
		return

	def stop(signum, frame):
		raise CheckTimeout

	started = monotonic()
	previous = signal.signal(signal.SIGALRM, stop)
	signal.setitimer(signal.ITIMER_REAL, seconds)
	try:
		yield
	finally:
		signal.setitimer(signal.ITIMER_REAL, 0)
		signal.signal(signal.SIGALRM, previous)
		if outer:
			signal.setitimer(signal.ITIMER_REAL, max(outer - (monotonic() - started), 0.001))


def approver_allowed(doc) -> bool:
	if doc.doctype not in REGISTRY or doc.is_new():
		return False
	if doc.get("workflow_state") not in APPROVER_STATES[doc.doctype]:
		return False
	if not get_workflow_name(doc.doctype) or not doc.has_permission("read"):
		return False
	return bool(get_transitions(doc))


def evaluate(check: Check, ctx: Context) -> Result:
	roles = ROLE_RESTRICTED.get(check.id)
	if roles and not ctx.roles.intersection(roles):
		return Result(NA, _("Restricted to audit roles."))
	started = monotonic()
	try:
		with time_limit(CHECK_SECONDS):
			result = check.run(ctx)
	except CheckTimeout:
		return not_finished()
	except Unverifiable as reason:
		return Result(UNKNOWN, str(reason))
	except Exception as error:
		return Result(UNKNOWN, _("Could not verify: {0}").format(type(error).__name__), error=True)
	if monotonic() - started > CHECK_SECONDS:
		return not_finished()
	return result


def not_finished() -> Result:
	return Result(TIMEOUT, _("The check did not finish within {0} seconds.").format(CHECK_SECONDS))


def item(check: Check, result: Result) -> dict:
	return {
		"id": check.id,
		"code": check.code,
		"category": check.category,
		"label": str(check.label),
		"status": result.status,
		"severity": result.severity or check.severity,
		"detail": result.detail,
		"evidence": result.evidence,
		"mode": check.mode,
		"error": result.error,
	}


def run(doc, checks=None, deferred: bool = False) -> dict:
	ctx = Context(doc)
	checks = checks or REGISTRY[doc.doctype]
	stored = stored_items(doc) if deferred else None
	items = []
	for check in checks:
		if deferred and check.background:
			items.append((stored or {}).get(check.id) or item(check, Result(PENDING, _("Reading the attachments; the result appears here when it is ready."))))
		else:
			items.append(item(check, evaluate(check, ctx)))
	if deferred and stored is None and any(check.background for check in checks):
		frappe.enqueue(
			"afmco.approver_check.engine.run_background",
			queue="short",
			timeout=BACKGROUND_SECONDS,
			job_id=result_key(doc),
			deduplicate=True,
			enqueue_after_commit=True,
			doctype=doc.doctype,
			name=doc.name,
			modified=str(doc.modified),
		)
	return payload(doc, withhold_unreadable(items))


def payload(doc, items: list[dict]) -> dict:
	counts = Counter(row["status"] for row in items)
	return {
		"doctype": doc.doctype,
		"name": doc.name,
		"ran_at": now(),
		"engine_version": ENGINE_VERSION,
		"ai_enabled": bool(frappe.conf.get(AI_KEY)),
		"counts": {status: counts.get(status, 0) for status in STATUSES},
		"blocking": any(row["status"] == FAIL and row["severity"] == BLOCK for row in items),
		"categories": [{"id": category, "label": category_label(category)} for category in CATEGORIES],
		"items": items,
	}


def result_key(doc) -> str:
	return f"afmco-approver-check:{doc.doctype}:{doc.name}:{doc.modified}:{frappe.session.user}"


def stored_items(doc) -> dict | None:
	return frappe.cache.get_value(result_key(doc))


def forget(doc) -> None:
	frappe.cache.delete_value(result_key(doc))


def run_background(doctype: str, name: str, modified: str) -> None:
	doc = frappe.get_doc(doctype, name)
	if str(doc.modified) != modified or not approver_allowed(doc):
		return
	ctx = Context(doc)
	items = {check.id: item(check, evaluate(check, ctx)) for check in REGISTRY[doctype] if check.background}
	frappe.cache.set_value(result_key(doc), items, expires_in_sec=RESULT_SECONDS)
	frappe.publish_realtime(RESULT_EVENT, {"doctype": doctype, "name": name, "modified": modified}, user=frappe.session.user)


def withhold_unreadable(items: list[dict]) -> list[dict]:
	allowed = {}

	def readable(link) -> bool:
		key = (link["doctype"], link["name"])
		if key not in allowed:
			allowed[key] = not frappe.db.exists(*key) or bool(frappe.has_permission(key[0], "read", doc=key[1]))
		return allowed[key]

	scoped = []
	for row in items:
		links = [entry["link"] for entry in row["evidence"] if entry.get("link") and entry["link"]["doctype"] in SENSITIVE]
		if all(readable(link) for link in links):
			scoped.append(row)
		else:
			scoped.append({**row, "status": UNKNOWN, "detail": _("No permission to verify."), "evidence": [], "error": False})
	return scoped


def run_blocks(doc) -> dict:
	return run(doc, [check for check in REGISTRY[doc.doctype] if check.severity == BLOCK])


def category_label(category: str) -> str:
	return {
		"accounting": _("Accounting"),
		"attachments": _("Attachments"),
		"beneficiary": _("Beneficiary account"),
		"policy": _("Policy and labour law"),
		"fraud": _("Fraud red flags"),
	}[category]

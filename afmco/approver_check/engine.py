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
from frappe.utils import get_datetime, now

from afmco.approver_check.model import (
	AI,
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

ENGINE_VERSION = "2"
CHECK_SECONDS = 10
BACKGROUND_SECONDS = 120
LOCK_SECONDS = 600
RESULT_EVENT = "afmco_approver_check_result"
STORE = "Approver Check Result"
PRIVILEGED = "Administrator"
RECHECK_ROLE = "System Manager"
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


def set_onload(doc) -> None:
	doc.set_onload("approver_check_allowed", approver_allowed(doc))
	doc.set_onload("approver_check_ai", bool(ai_first(doc.doctype)))


def restricted(check: Check, ctx: Context) -> bool:
	roles = ROLE_RESTRICTED.get(check.id)
	return bool(roles) and not ctx.roles.intersection(roles)


def evaluate(check: Check, ctx: Context) -> Result:
	ctx.needs = []
	if restricted(check, ctx):
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
	if deferred:
		return checklist(doc)
	ctx = Context(doc)
	return payload(doc, withhold_unreadable([item(check, evaluate(check, ctx)) for check in (REGISTRY[doc.doctype] if checks is None else checks)]))


def checklist(doc) -> dict:
	stored = stored_items(doc) or {}
	if any(check.id not in stored for check in shared(doc.doctype) if not check.background):
		if not claim(doc):
			running = Result(PENDING, _("The check is running; the result appears here when it is ready."))
			return payload(doc, [item(check, running) for check in additional(doc.doctype)])
		stored = compute(doc, stored)
	return serve(doc, stored)


def ai_first(doctype: str) -> list[Check]:
	return [check for check in REGISTRY[doctype] if check.mode == AI]


def additional(doctype: str) -> list[Check]:
	return [check for check in REGISTRY[doctype] if check.mode != AI]


def shared(doctype: str) -> list[Check]:
	return [check for check in additional(doctype) if not check.viewer]


def measured(check: Check, ctx: Context) -> dict:
	return {**item(check, evaluate(check, ctx)), "needs": ctx.needs}


def compute(doc, stored: dict) -> dict:
	ctx = Context(doc, PRIVILEGED)
	stored = {**stored, **{check.id: measured(check, ctx) for check in shared(doc.doctype) if not check.background}}
	save(doc, stored)
	if not complete(doc, stored):
		frappe.enqueue(
			"afmco.approver_check.engine.run_background",
			queue="short",
			timeout=BACKGROUND_SECONDS,
			job_id=lock_key(doc),
			deduplicate=True,
			enqueue_after_commit=True,
			doctype=doc.doctype,
			name=doc.name,
			modified=str(doc.modified),
		)
	return stored


def run_background(doctype: str, name: str, modified: str) -> None:
	doc = frappe.get_doc(doctype, name)
	if str(doc.modified) != modified:
		return
	ctx = Context(doc, PRIVILEGED)
	stored = stored_items(doc) or {}
	stored.update({check.id: measured(check, ctx) for check in shared(doctype) if check.background})
	save(doc, stored)
	frappe.publish_realtime(RESULT_EVENT, {"doctype": doctype, "name": name, "modified": modified}, doctype=doctype, docname=name)


def complete(doc, stored: dict | None) -> bool:
	return stored is not None and all(check.id in stored for check in shared(doc.doctype))


def serve(doc, stored: dict) -> dict:
	viewer = Context(doc)
	rows = []
	for check in additional(doc.doctype):
		if check.viewer:
			rows.append(item(check, evaluate(check, viewer)))
		elif check.id not in stored:
			rows.append(item(check, Result(PENDING, _("Reading the attachments; the result appears here when it is ready."))))
		elif restricted(check, viewer):
			rows.append(item(check, Result(NA, _("Restricted to audit roles."))))
		else:
			row = {key: value for key, value in stored[check.id].items() if key != "needs"}
			granted = all(viewer.grants(need) for need in stored[check.id].get("needs") or [])
			rows.append(row if granted else withheld(row))
	return payload(doc, withhold_unreadable(rows))


def payload(doc, items: list[dict]) -> dict:
	counts = Counter(row["status"] for row in items)
	return {
		"doctype": doc.doctype,
		"name": doc.name,
		"ran_at": now(),
		"engine_version": ENGINE_VERSION,
		"counts": {status: counts.get(status, 0) for status in STATUSES},
		"blocking": any(row["status"] == FAIL and row["severity"] == BLOCK for row in items),
		"categories": [{"id": category, "label": category_label(category)} for category in CATEGORIES],
		"items": items,
	}


def lock_key(doc) -> str:
	return f"afmco-approver-check:{doc.doctype}:{doc.name}:{doc.modified}"


def claim(doc) -> bool:
	key = lock_key(doc)
	if not frappe.cache.set(frappe.cache.make_key(key), frappe.session.user, nx=True, ex=LOCK_SECONDS):
		return False
	frappe.db.after_commit.add(lambda: frappe.cache.delete_value(key))
	frappe.db.after_rollback.add(lambda: frappe.cache.delete_value(key))
	return True


def reference(doc) -> dict:
	return {"reference_doctype": doc.doctype, "reference_name": doc.name}


def stored_items(doc) -> dict | None:
	row = frappe.db.get_value(STORE, reference(doc), ["document_modified", "engine_version", "result"], as_dict=True)
	if not row or row.engine_version != ENGINE_VERSION or get_datetime(row.document_modified) != get_datetime(doc.modified):
		return None
	return frappe.parse_json(row.result) or {}


def save(doc, stored: dict) -> None:
	values = {"document_modified": doc.modified, "engine_version": ENGINE_VERSION, "result": frappe.as_json(stored)}
	name = frappe.db.get_value(STORE, reference(doc))
	if name:
		frappe.db.set_value(STORE, name, values)
	else:
		frappe.get_doc({"doctype": STORE, **reference(doc), **values}).insert(ignore_permissions=True)


def forget(doc) -> None:
	frappe.db.delete(STORE, reference(doc))
	frappe.cache.delete_value(lock_key(doc))


def withheld(row: dict) -> dict:
	return {**row, "status": UNKNOWN, "detail": _("No permission to verify."), "evidence": [], "error": False}


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
		scoped.append(row if all(readable(link) for link in links) else withheld(row))
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

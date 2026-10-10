# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from collections import Counter

import frappe
from frappe import _
from frappe.model.workflow import get_transitions, get_workflow_name
from frappe.utils import now

from afmco.approver_check.model import (
	BLOCK,
	CATEGORIES,
	FAIL,
	NA,
	STATUSES,
	UNKNOWN,
	Check,
	Context,
	Result,
	Unverifiable,
)
from afmco.approver_check.registry import APPROVER_STATES, REGISTRY, ROLE_RESTRICTED

ENGINE_VERSION = "1"
AI_KEY = "afmco_approver_ai_key"


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
	try:
		return check.run(ctx)
	except Unverifiable as reason:
		return Result(UNKNOWN, str(reason))
	except Exception as error:
		return Result(UNKNOWN, _("Could not verify: {0}").format(type(error).__name__), error=True)


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


def run(doc, checks=None) -> dict:
	ctx = Context(doc)
	items = [item(check, evaluate(check, ctx)) for check in (checks or REGISTRY[doc.doctype])]
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

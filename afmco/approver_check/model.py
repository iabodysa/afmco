# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from collections.abc import Callable
from dataclasses import dataclass, field

import frappe
from frappe import _
from frappe.utils import getdate, nowdate

PASS = "pass"
FAIL = "fail"
WARN = "warn"
UNKNOWN = "unknown"
NA = "na"
PENDING = "pending"
TIMEOUT = "timeout"
STATUSES = (FAIL, WARN, UNKNOWN, TIMEOUT, PENDING, PASS, NA)

BLOCK = "block"
WARNING = "warn"
INFO = "info"

DETERMINISTIC = "det"
AI = "ai"

ACCOUNTING = "accounting"
ATTACHMENTS = "attachments"
BENEFICIARY = "beneficiary"
POLICY = "policy"
FRAUD = "fraud"
CATEGORIES = (ACCOUNTING, ATTACHMENTS, BENEFICIARY, POLICY, FRAUD)

EMPLOYEE = "Employee"
PAYMENT_REQUISITION = "Payment Requisition"


class Unverifiable(Exception):
	pass


def no_permission() -> Unverifiable:
	return Unverifiable(_("No permission to verify."))


@dataclass
class Result:
	status: str
	detail: str = ""
	evidence: list[dict] = field(default_factory=list)
	severity: str | None = None
	error: bool = False


@dataclass(frozen=True)
class Check:
	id: str
	code: str
	category: str
	label: object
	severity: str
	run: Callable[[Context], Result]
	mode: str = DETERMINISTIC
	background: bool = False
	viewer: bool = False


def evidence(label, value, doctype: str | None = None, name: str | None = None) -> dict:
	row = {"label": str(label), "value": "" if value is None else str(value)}
	if doctype and name:
		row["link"] = {"doctype": doctype, "name": name}
	return row


class Context:
	def __init__(self, doc, user: str | None = None):
		self.doc = doc
		self.user = user or frappe.session.user
		self.roles = set(frappe.get_roles(self.user))
		self.today = getdate(nowdate())
		self.memo = {}
		self.needs = []

	def remember(self, key, compute):
		if key not in self.memo:
			outer, self.needs = self.needs, []
			try:
				value = compute()
			finally:
				inner, self.needs = self.needs, outer
			self.memo[key] = (value, inner)
		value, needs = self.memo[key]
		self.needs.extend(needs)
		return value

	def need(self, doctype: str, names=(), fields=()) -> None:
		self.needs.append({"doctype": doctype, "names": sorted(set(names)), "fields": list(fields)})

	def grants(self, need: dict) -> bool:
		return self.remember(("grant", need["doctype"], tuple(need["names"]), tuple(need["fields"])), lambda: self.permits(need))

	def permits(self, need: dict) -> bool:
		doctype, names = need["doctype"], set(need["names"])
		if not frappe.has_permission(doctype, "read", user=self.user):
			return False
		if names and self.listed(doctype, names) != names:
			return False
		return self.permlevels(doctype, need["fields"])

	def listed(self, doctype: str, names) -> set[str]:
		return set(frappe.get_list(doctype, filters={"name": ["in", list(names)]}, pluck="name", limit_page_length=0, user=self.user))

	def permlevels(self, doctype: str, fields) -> bool:
		meta = frappe.get_meta(doctype)
		levels = meta.get_permlevel_access("read", user=self.user)
		return all((df := meta.get_field(f)) is not None and df.permlevel in levels for f in fields)

	def can_read(self, doctype: str, doc) -> bool:
		self.need(doctype, [getattr(doc, "name", doc)])
		return bool(frappe.has_permission(doctype, "read", doc=doc, user=self.user))

	def readable_names(self, doctype: str, names) -> set[str]:
		names = list(set(names))
		if not names:
			return set()
		self.need(doctype, names)
		if not frappe.has_permission(doctype, "read", user=self.user):
			return set()
		return self.listed(doctype, names)

	def employee(self, name: str | None, fields: tuple[str, ...]):
		if not name:
			raise Unverifiable(_("No employee is linked to this record."))
		record = self.remember(("employee", name), lambda: employee_or_none(name))
		if record is None:
			raise Unverifiable(_("Employee {0} was not found.").format(name))
		if not self.can_read(EMPLOYEE, record):
			raise no_permission()
		self.need(EMPLOYEE, [record.name], fields)
		if not self.permlevels(EMPLOYEE, fields):
			raise no_permission()
		return record

	def may_read_employee_fields(self, fields: tuple[str, ...]) -> bool:
		self.need(EMPLOYEE, (), fields)
		return bool(frappe.has_permission(EMPLOYEE, "read", user=self.user)) and self.permlevels(EMPLOYEE, fields)


def employee_or_none(name: str):
	if not frappe.db.exists(EMPLOYEE, name):
		return None
	return frappe.get_doc(EMPLOYEE, name)

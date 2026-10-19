# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import html
import json
import re

import frappe
from frappe.utils import add_to_date, get_datetime, now_datetime, strip_html

PAYMENT_REQUISITION = "Payment Requisition"
ACCOUNTS_BOT_ROLE = "Accountant Bot"
CHOICE_TAG = "[accounts-bot-choice q="
CHOICE = re.compile(r"^\[accounts-bot-choice q=([A-Za-z0-9_.-]+)\]$")
ANSWER_TAG = "[accounts-bot-answer q={0}]"
OPEN_EVENT = "accounts_bot_choice"
CLOSE_EVENT = "accounts_bot_choice_closed"
BUTTON_IDS = ("1", "2", "3", "4", "5", "none")
NO_CHOICE = "none"
LIMITS = {"title": 120, "text": 300, "label": 140, "hint": 140}
ATTEMPTS = 3
ATTEMPT_MINUTES = 5
SENT_KEY = "afmco:accounts_bot_choice_sent:{0}"
REQUEST_SENT = "Request Sent"


def content_lines(content: str | None) -> list[str]:
	return [line for part in re.split(r"\r?\n|<br\s*/?>", content or "", flags=re.I) if (line := strip_html(part).strip())]


def clean_text(value, limit: int, required: bool = True) -> str | None:
	if not value and not required:
		return None
	if not isinstance(value, str) or not value.strip() or len(value) > limit or "<" in value or ">" in value:
		raise ValueError
	return value


def parse_choice(content: str | None) -> dict | None:
	lines = content_lines(content)
	match = lines and CHOICE.match(lines[0])
	if not match or len(lines) < 2:
		return None
	try:
		body = json.loads(html.unescape(lines[1]))
		buttons = body["buttons"]
		if not isinstance(buttons, list) or not 3 <= len(buttons) <= 6:
			raise ValueError
		parsed = [
			{
				"id": button["id"],
				"label": clean_text(button["label"], LIMITS["label"]),
				"hint": clean_text(button.get("hint"), LIMITS["hint"], required=False),
			}
			for button in buttons
		]
		ids = [button["id"] for button in parsed]
		if any(i not in BUTTON_IDS for i in ids) or len(set(ids)) != len(ids) or ids[-1] != NO_CHOICE:
			raise ValueError
		if body.get("drafted") not in ids:
			raise ValueError
		return {
			"q": match.group(1),
			"title": clean_text(body["title"], LIMITS["title"]),
			"text": clean_text(body["text"], LIMITS["text"]),
			"buttons": parsed,
			"drafted": body["drafted"],
		}
	except (ValueError, KeyError, TypeError, AttributeError):
		return None


def bot_users() -> list[str]:
	return frappe.get_all("Has Role", filters={"role": ACCOUNTS_BOT_ROLE, "parenttype": "User"}, pluck="parent")


def choice_comments(name: str, since=None) -> list:
	filters = {
		"reference_doctype": PAYMENT_REQUISITION,
		"comment_type": "Info",
		"content": ["like", f"%{CHOICE_TAG}%"],
		"owner": ["in", bot_users() or [""]],
	}
	if name:
		filters["reference_name"] = name
	if since:
		filters["creation"] = [">=", since]
	return frappe.get_all(
		"Comment", filters=filters, fields=["reference_name", "content", "creation"], order_by="creation desc"
	)


def latest_choice(name: str) -> dict | None:
	rows = choice_comments(name)
	if not rows or not (choice := parse_choice(rows[0].content)):
		return None
	return {**choice, "pr": name, "creation": rows[0].creation}


def is_answered(name: str, q: str) -> bool:
	return bool(
		frappe.db.exists(
			"Comment",
			{
				"reference_doctype": PAYMENT_REQUISITION,
				"reference_name": name,
				"comment_type": "Info",
				"content": ["like", f"%{ANSWER_TAG.format(q)}%"],
			},
		)
	)


def open_choice(name: str) -> dict | None:
	choice = latest_choice(name)
	if not choice or is_answered(name, choice["q"]):
		return None
	press = last_press(name)
	if press and get_datetime(press.creation) > get_datetime(choice["creation"]):
		return None
	return choice


def last_press(name: str):
	for row in frappe.get_all(
		"Version",
		filters={"ref_doctype": PAYMENT_REQUISITION, "docname": name, "data": ["like", '%"accounts_bot_status"%']},
		fields=["owner", "data", "creation"],
		order_by="creation desc",
		limit=20,
	):
		changed = (frappe.parse_json(row.data) or {}).get("changed") or []
		if any(change[0] == "accounts_bot_status" and change[2] == REQUEST_SENT for change in changed):
			return row
	return None


def presser(name: str) -> str | None:
	press = last_press(name)
	return press.owner if press else None


def publish(event: str, choice: dict, user: str | None) -> None:
	message = {key: choice[key] for key in ("pr", "q", "title", "text", "buttons", "drafted") if key in choice}
	if user:
		frappe.publish_realtime(event, message, user=user, after_commit=True)
	frappe.publish_realtime(event, message, doctype=PAYMENT_REQUISITION, docname=choice["pr"], after_commit=True)


def publish_choice(choice: dict, attempt: int) -> None:
	publish(OPEN_EVENT, choice, presser(choice["pr"]))
	frappe.cache.set_value(SENT_KEY.format(choice["q"]), attempt, expires_in_sec=ATTEMPTS * ATTEMPT_MINUTES * 60 + 300)


def publish_close(name: str, q: str, user: str | None) -> None:
	publish(CLOSE_EVENT, {"pr": name, "q": q}, user)
	frappe.cache.delete_value(SENT_KEY.format(q))


def republish_open_choices() -> None:
	since = add_to_date(now_datetime(), minutes=-(ATTEMPTS * ATTEMPT_MINUTES + 1))
	seen = set()
	for row in choice_comments(None, since):
		if row.reference_name in seen:
			continue
		seen.add(row.reference_name)
		choice = open_choice(row.reference_name)
		if not choice or choice["creation"] != row.creation:
			continue
		elapsed = (now_datetime() - get_datetime(row.creation)).total_seconds() // 60
		if elapsed >= ATTEMPTS * ATTEMPT_MINUTES:
			continue
		due = min(ATTEMPTS, 1 + int(elapsed // ATTEMPT_MINUTES))
		if due > int(frappe.cache.get_value(SENT_KEY.format(choice["q"])) or 0):
			publish_choice(choice, due)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.translate import get_user_lang
from frappe.utils import now_datetime

BOT_BUSY_STATUSES = (
	"Queued",
	"Reading File",
	"File Read",
	"Checking Rules",
	"Building Invoice",
	"Building Salary",
	"Comparing",
	"Drafts Created",
)


@frappe.whitelist(methods=["POST"])
def start_payroll_bot(name):
	doc = frappe.get_doc("Client Timesheet", name)
	doc.check_permission("write")
	if doc.bot_status in BOT_BUSY_STATUSES:
		frappe.throw(_("The Payroll Bot is already working on this timesheet."))
	doc.bot_status = "Queued"
	doc.queued_by = frappe.session.user
	doc.queued_lang = get_user_lang()
	doc.queued_on = now_datetime()
	doc.flags.ignore_permissions = True
	doc.save()
	return doc.bot_status

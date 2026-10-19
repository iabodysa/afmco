# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import frappe

from afmco.financial_operations import accounts_bot_choice


class AfmcoComment:
	def after_insert(self):
		super().after_insert()
		if (
			self.reference_doctype == accounts_bot_choice.PAYMENT_REQUISITION
			and self.comment_type == "Info"
			and accounts_bot_choice.CHOICE_TAG in (self.content or "")
			and accounts_bot_choice.ACCOUNTS_BOT_ROLE in frappe.get_roles(self.owner)
			and accounts_bot_choice.is_finished(self.reference_name)
		):
			choice = accounts_bot_choice.open_choice(self.reference_name)
			if choice and choice["q"] == (accounts_bot_choice.parse_choice(self.content) or {}).get("q"):
				accounts_bot_choice.publish_choice(choice, 1)

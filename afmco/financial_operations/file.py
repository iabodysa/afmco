# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

PAYMENT_REQUISITION = "Payment Requisition"


class AfmcoFile:
	def before_insert(self):
		if self.attached_to_doctype == PAYMENT_REQUISITION and not self.file_url:
			self.is_private = 1
		super().before_insert()

	def validate(self):
		previous = self.get_doc_before_save()
		if (
			self.attached_to_doctype == PAYMENT_REQUISITION
			and previous
			and previous.is_private
			and not self.is_private
		):
			self.is_private = 1
		super().validate()

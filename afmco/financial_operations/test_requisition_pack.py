# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import io
from unittest.mock import patch

import frappe
import pikepdf
from frappe.tests import IntegrationTestCase
from frappe.utils import add_days, getdate, today
from PIL import Image

from afmco.financial_operations import requisition_pack
from afmco.financial_operations.api.requisition_pack import attach_pack

COMPANY = "_Test Requisition Pack Company"
A4_WIDTH_POINTS = 595


def make_pdf(width: int, pages: int = 1) -> bytes:
	pdf = pikepdf.Pdf.new()
	for _ in range(pages):
		pdf.add_blank_page(page_size=(width, 842))
	output = io.BytesIO()
	pdf.save(output)
	return output.getvalue()


def make_png(width: int, height: int) -> bytes:
	output = io.BytesIO()
	Image.effect_noise((width, height), 64).convert("RGB").save(output, "PNG")
	return output.getvalue()


def make_text_pdf() -> bytes:
	pdf = pikepdf.Pdf.new()
	pdf.add_blank_page(page_size=(A4_WIDTH_POINTS, 842))
	pdf.pages[0].Contents = pdf.make_stream(b"BT /F1 12 Tf 72 720 Td (Small text page) Tj ET\n" * 200)
	output = io.BytesIO()
	pdf.save(output, compress_streams=False)
	return output.getvalue()


def uncompressed_pages(content: bytes) -> int:
	return sum(
		1
		for page in pikepdf.Pdf.open(io.BytesIO(content)).pages
		if "/Contents" in page.obj and "/Filter" not in page.obj.Contents
	)


def page_widths(content: bytes) -> list[int]:
	return [round(float(page.mediabox[2])) for page in pikepdf.Pdf.open(io.BytesIO(content)).pages]


def make_requisition() -> str:
	return (
		frappe.get_doc(
			{
				"doctype": "Payment Requisition",
				"account_no": "SA0000000000000000000000",
				"beneficiary_name": "Pack Beneficiary",
				"remark": "Pack test",
				"amount": 100,
			}
		)
		.insert()
		.name
	)


def attach_file(requisition: str, file_name: str, content: bytes) -> None:
	frappe.get_doc(
		{
			"doctype": "File",
			"file_name": file_name,
			"attached_to_doctype": "Payment Requisition",
			"attached_to_name": requisition,
			"is_private": 1,
			"content": content,
		}
	).insert()


def make_journal_entry(requisition: str) -> str:
	if not frappe.db.exists("Warehouse Type", "Transit"):
		frappe.get_doc({"doctype": "Warehouse Type", "name": "Transit"}).insert()
	if not frappe.db.exists("Company", COMPANY):
		frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": COMPANY,
				"abbr": "_TRP",
				"default_currency": "SAR",
				"country": "Saudi Arabia",
			}
		).insert()
	start = getdate(today()).replace(month=1, day=1)
	if not frappe.db.exists(
		"Fiscal Year", {"year_start_date": ("<=", today()), "year_end_date": (">=", today())}
	):
		frappe.get_doc(
			{
				"doctype": "Fiscal Year",
				"year": f"_Test Requisition Pack {start.year}",
				"year_start_date": start,
				"year_end_date": add_days(start.replace(year=start.year + 1), -1),
			}
		).insert()
	company = frappe.get_doc("Company", COMPANY)
	expense = frappe.get_all(
		"Account", filters={"company": COMPANY, "root_type": "Expense", "is_group": 0}, pluck="name", limit=1
	)[0]
	cash = frappe.get_all(
		"Account", filters={"company": COMPANY, "account_type": "Cash", "is_group": 0}, pluck="name", limit=1
	)[0]
	return (
		frappe.get_doc(
			{
				"doctype": "Journal Entry",
				"company": COMPANY,
				"posting_date": today(),
				"expense_request_cf": requisition,
				"accounts": [
					{
						"account": expense,
						"cost_center": company.cost_center,
						"debit_in_account_currency": 100,
					},
					{"account": cash, "credit_in_account_currency": 100},
				],
			}
		)
		.insert()
		.name
	)


class TestRequisitionPack(IntegrationTestCase):
	def test_print_lists_workflow_history_then_comments_in_creation_order(self):
		requisition = make_requisition()
		doc = frappe.get_doc("Payment Requisition", requisition)
		doc.add_comment("Workflow", "Waiting P.M Approval")
		doc.add_comment("Comment", "<p>Invoice <b>checked</b> by site</p>")
		doc.add_comment("Workflow", "Paid")
		bare = make_requisition()

		html = frappe.get_print("Payment Requisition", requisition, requisition_pack.PRINT_FORMAT)
		bare_html = frappe.get_print("Payment Requisition", bare, requisition_pack.PRINT_FORMAT)

		self.assertIn("Approval History", html)
		self.assertLess(html.index("Waiting P.M Approval"), html.index("Paid"))
		self.assertIn("Invoice checked by site", html)
		self.assertLess(html.index("Approval History"), html.index("Invoice checked by site"))
		self.assertNotIn("Approval History", bare_html)
		self.assertNotIn("Invoice checked by site", bare_html)

	def test_default_print_format_is_payment_request_form(self):
		self.assertEqual(
			frappe.get_meta("Payment Requisition").default_print_format, requisition_pack.PRINT_FORMAT
		)

	def test_merge_appends_attachments_in_creation_order_and_reports_skipped(self):
		requisition = make_requisition()
		attach_file(requisition, "first.pdf", make_pdf(300, pages=2))
		attach_file(requisition, "photo.png", make_png(300, 400))
		attach_file(requisition, "sheet.xlsx", b"not a pdf")
		attach_file(requisition, "last.pdf", make_pdf(400))

		content, skipped = requisition_pack.merge(
			make_pdf(200), requisition_pack.requisition_files(requisition), downsample=False
		)

		self.assertEqual(page_widths(content), [200, 300, 300, A4_WIDTH_POINTS, 400])
		self.assertEqual(skipped, ["sheet.xlsx"])

	def test_merge_always_compresses_small_text_pdf(self):
		requisition = make_requisition()
		text_pdf = make_text_pdf()
		attach_file(requisition, "small.pdf", text_pdf)

		content, _ = requisition_pack.merge(
			make_pdf(200), requisition_pack.requisition_files(requisition), downsample=False
		)

		self.assertLess(len(text_pdf), requisition_pack.MEGABYTE)
		self.assertGreater(uncompressed_pages(text_pdf), 0)
		self.assertEqual(uncompressed_pages(content), 0)

	def test_downsample_bounds_image_resolution_and_keeps_it_otherwise(self):
		content = make_png(2480, 3508)

		kept = requisition_pack.image_pdf(content, downsample=False)
		reduced = requisition_pack.image_pdf(content, downsample=True)

		def image_width(pdf):
			return int(next(iter(pdf.pages[0].images.values())).Width)

		self.assertEqual(image_width(kept), 2480)
		self.assertLessEqual(image_width(reduced), int(8.27 * requisition_pack.DOWNSAMPLE_DPI))
		self.assertEqual(round(float(reduced.pages[0].mediabox[2])), A4_WIDTH_POINTS)

	def test_attach_pack_replaces_previous_pack_on_journal_entry(self):
		requisition = make_requisition()
		attach_file(requisition, "invoice.pdf", make_pdf(300))
		journal_entry = make_journal_entry(requisition)

		with patch("frappe.get_print", return_value=make_pdf(200)):
			attach_pack(requisition, journal_entry)
			result = attach_pack(requisition, journal_entry)

		packs = frappe.get_all(
			"File",
			filters={"attached_to_doctype": "Journal Entry", "attached_to_name": journal_entry},
			pluck="name",
		)
		self.assertEqual(len(packs), 1)
		pack = frappe.get_doc("File", packs[0])
		self.assertEqual(pack.file_name, f"{requisition}-pack.pdf")
		self.assertEqual(result["file_url"], pack.file_url)
		with open(pack.get_full_path(), "rb") as stored:
			self.assertEqual(page_widths(stored.read()), [200, 300])

	def test_attach_pack_enqueues_above_background_threshold(self):
		requisition = make_requisition()
		attach_file(requisition, "invoice.pdf", make_pdf(300))
		journal_entry = make_journal_entry(requisition)

		with (
			patch.object(requisition_pack, "BACKGROUND_THRESHOLD", 0),
			patch("frappe.enqueue") as enqueue,
		):
			result = attach_pack(requisition, journal_entry)

		self.assertEqual(result, {"queued": True})
		self.assertIs(enqueue.call_args.args[0], requisition_pack.attach)
		self.assertEqual(enqueue.call_args.kwargs["journal_entry"], journal_entry)

	def test_attach_pack_refuses_journal_entry_of_another_requisition(self):
		journal_entry = make_journal_entry(make_requisition())

		with self.assertRaises(frappe.ValidationError):
			attach_pack(make_requisition(), journal_entry)

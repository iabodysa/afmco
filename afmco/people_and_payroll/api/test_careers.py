# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from io import BytesIO

import frappe
from frappe.tests import IntegrationTestCase
from frappe.website.path_resolver import resolve_redirect
from frappe.website.serve import get_response_content
from pypdf import PdfWriter
from werkzeug.test import EnvironBuilder
from werkzeug.wrappers import Request

from afmco.people_and_payroll.api.careers import apply
from afmco.people_and_payroll.careers import MAX_RESUME_BYTES, create_application

APPLY_CMD = "afmco.people_and_payroll.api.careers.apply"
DESIGNATION = "Careers Test Designation"
COMPANY = "Careers Test Company"


def make_pdf():
	writer = PdfWriter()
	writer.add_blank_page(width=72, height=72)
	buffer = BytesIO()
	writer.write(buffer)
	return buffer.getvalue()


PDF = make_pdf()


def make_company():
	if not frappe.db.exists("Warehouse Type", "Transit"):
		frappe.get_doc({"doctype": "Warehouse Type", "name": "Transit"}).insert()
	if not frappe.db.exists("Company", COMPANY):
		frappe.get_doc(
			{
				"doctype": "Company",
				"company_name": COMPANY,
				"abbr": "CTC",
				"default_currency": "SAR",
				"country": "Saudi Arabia",
			}
		).insert()
	return COMPANY


def make_job_opening(job_title, publish=1, status="Open"):
	company = make_company()
	if not frappe.db.exists("Designation", DESIGNATION):
		frappe.get_doc({"doctype": "Designation", "designation_name": DESIGNATION}).insert()
	return frappe.get_doc(
		{
			"doctype": "Job Opening",
			"job_title": job_title,
			"designation": DESIGNATION,
			"company": company,
			"status": status,
			"publish": publish,
			"description": "<p>Drive the careers test fleet.</p><script>alert(1)</script>",
		}
	).insert()


def valid_values(**overrides):
	values = {
		"applicant_name": "Careers Applicant",
		"email_id": "careers.applicant@afmco.test",
		"phone_number": "+966500000000",
	}
	values.update(overrides)
	return values


class TestCareersApplication(IntegrationTestCase):
	def test_missing_name_or_email_is_rejected_and_nothing_is_created(self):
		before = frappe.db.count("Job Applicant")
		for values in (valid_values(applicant_name=" "), valid_values(email_id=""), valid_values(email_id="nope"), valid_values(phone_number="")):
			with self.assertRaises(frappe.ValidationError):
				create_application(values)
		self.assertEqual(frappe.db.count("Job Applicant"), before)

	def test_resume_with_disallowed_type_or_spoofed_content_or_oversize_is_rejected(self):
		before = frappe.db.count("File", {"is_private": 1})
		for filename, content in (
			("cv.exe", b"MZ\x90\x00"),
			("cv.pdf", b"<html>not a pdf</html>"),
			("cv.docx", PDF),
			("cv.pdf", PDF + b"0" * MAX_RESUME_BYTES),
		):
			with self.assertRaises(frappe.ValidationError):
				create_application(valid_values(), filename, content)
		self.assertEqual(frappe.db.count("File", {"is_private": 1}), before)

	def test_closed_or_unpublished_job_is_rejected(self):
		closed = make_job_opening("Careers Closed Job", status="Closed")
		hidden = make_job_opening("Careers Hidden Job", publish=0)
		for job in (closed, hidden):
			with self.assertRaises(frappe.ValidationError):
				create_application(valid_values(job_title=job.name))

	def test_valid_application_creates_job_applicant_with_private_attached_cv(self):
		job = make_job_opening("Careers Open Job")
		applicant = create_application(
			valid_values(job_title=job.name, country="Saudi Arabia", lower_range="4000", upper_range="6000"),
			"My CV.pdf",
			PDF,
		)
		saved = frappe.get_doc("Job Applicant", applicant.name)
		self.assertEqual(saved.job_title, job.name)
		self.assertEqual(saved.status, "Open")
		self.assertEqual((saved.lower_range, saved.upper_range), (4000, 6000))
		cv = frappe.get_doc("File", {"file_url": saved.resume_attachment})
		self.assertEqual(cv.is_private, 1)
		self.assertEqual((cv.attached_to_doctype, cv.attached_to_name), ("Job Applicant", saved.name))

	def test_guest_cannot_read_the_created_applicant_or_cv(self):
		applicant = create_application(valid_values(), "cv.pdf", PDF)
		frappe.set_user("Guest")
		try:
			self.assertFalse(frappe.has_permission("Job Applicant", "read", applicant.name))
			cv = frappe.get_doc("File", {"file_url": applicant.resume_attachment})
			self.assertFalse(cv.is_downloadable())
		finally:
			frappe.set_user("Administrator")


class TestCareersEndpointRateLimit(IntegrationTestCase):
	def setUp(self):
		frappe.cache.delete_keys(f"rl:{APPLY_CMD}")
		builder = EnvironBuilder(method="POST", path=f"/api/method/{APPLY_CMD}", data={})
		frappe.local.request = Request(builder.get_environ())
		frappe.local.request_ip = "203.0.113.77"
		frappe.local.form_dict = frappe._dict(cmd=APPLY_CMD)

	def tearDown(self):
		frappe.cache.delete_keys(f"rl:{APPLY_CMD}")
		frappe.local.request = None
		frappe.local.form_dict = frappe._dict()

	def test_sixth_submission_from_one_address_within_an_hour_is_refused(self):
		for _attempt in range(5):
			with self.assertRaises(frappe.ValidationError) as caught:
				apply()
			self.assertNotIsInstance(caught.exception, frappe.RateLimitExceededError)
		with self.assertRaises(frappe.RateLimitExceededError):
			apply()


class TestCareersPage(IntegrationTestCase):
	def test_page_lists_published_open_jobs_with_apply_form_and_sanitized_details(self):
		shown = make_job_opening("Careers Listed Job")
		hidden = make_job_opening("Careers Unlisted Job", publish=0)
		frappe.set_user("Guest")
		try:
			html = get_response_content("careers")
		finally:
			frappe.set_user("Administrator")
		self.assertIn(shown.job_title, html)
		self.assertNotIn(hidden.job_title, html)
		self.assertNotIn("<script>alert(1)</script>", html)
		self.assertNotIn("₹", html)
		self.assertIn('action="/api/method/afmco.people_and_payroll.api.careers.apply"', html)
		for fieldname in ("job_title", "applicant_name", "email_id", "resume", "cover_letter", "lower_range"):
			self.assertIn(f'name="{fieldname}"', html)

	def test_old_job_application_web_form_route_redirects_to_careers_keeping_the_job(self):
		frappe.cache.delete_value("website_redirects")
		frappe.flags.redirect_location = None
		with self.assertRaises(frappe.Redirect):
			resolve_redirect("job_application/new", b"job_title=HR-OPN-0001")
		self.assertEqual(frappe.flags.redirect_location, "/careers?job_title=HR-OPN-0001")

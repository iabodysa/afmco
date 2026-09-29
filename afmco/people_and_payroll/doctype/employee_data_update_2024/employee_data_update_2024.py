import frappe
from frappe.model.document import Document


class EmployeeDataUpdate2024(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.derive_employee_details()

	def before_save(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.reparent_attachments()

	def reparent_attachments(self):
		files = frappe.get_all(
			"File",
			filters={"attached_to_doctype": self.doctype, "attached_to_name": self.name},
			pluck="name",
		)
		for file_name in files:
			try:
				attachment = frappe.get_doc("File", file_name)
				attachment.update({"attached_to_doctype": "Employee", "attached_to_name": self.employee})
				attachment.save()
			except Exception:
				frappe.log_error(title="Employee Data Update attachment transfer")

	def before_submit(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.update_employee_record()

	def derive_employee_details(self):
		if not self.first_name:
			frappe.throw("First Name is required and cannot be empty.")
		if not self.last_name:
			frappe.throw("Last Name is required and cannot be empty.")

		first_name = self.first_name or ''
		middle_name = self.middle_name or ''
		last_name = self.last_name or ''

		self.employee_name = f"{first_name} {middle_name} {last_name}".strip()

		if self.date_of_birth:
			today = frappe.utils.nowdate()
			birth_date = self.date_of_birth
			age_in_years = frappe.utils.date_diff(today, birth_date) // 365
			self.age = age_in_years

		if self.date_of_joining:
			today = frappe.utils.nowdate()
			joining_date = self.date_of_joining
			service_duration_in_years = frappe.utils.date_diff(today, joining_date) // 365
			self.service_duration = service_duration_in_years

	def update_employee_record(self):
		try:
			if not self.employee:
				frappe.throw("Employee field cannot be empty. Please select an employee.")

			try:
				employee = frappe.get_doc("Employee", self.employee)
			except frappe.DoesNotExistError:
				frappe.throw(f"Employee with ID {self.employee} does not exist. Please check the Employee ID and try again.")
			except Exception as e:
				frappe.throw(f"Failed to fetch the Employee record. Error: {str(e)}")

			try:
				if self.department:
					if frappe.db.exists("Department", self.department):
						employee.department = self.department
					else:
						frappe.throw(f"Department '{self.department}' does not exist. Please provide a valid department.")
			except Exception as e:
				frappe.throw(f"Failed to update department. Error: {str(e)}")

			try:
				if self.designation:
					if frappe.db.exists("Designation", self.designation):
						employee.designation = self.designation
					else:
						frappe.throw(f"Designation '{self.designation}' does not exist. Please provide a valid designation.")
			except Exception as e:
				frappe.throw(f"Failed to update designation. Error: {str(e)}")

			try:
				fields_to_update = [
					"employee_name", "date_of_birth", "nationality",
					"cell_number", "personal_email", "company_email",
					"prefered_contact_email", "current_address",
					"permanent_address", "person_to_be_contacted", "emergency_phone_number",
					"relation", "bank_name", "bank_ac_no", "marital_status",
					"family_background", "blood_group", "health_details", "bio", "image",
					"education", "external_work_history", "department", "designation"
				]
				for field in fields_to_update:
					if self.get(field):
						employee.set(field, self.get(field))
			except Exception as e:
				frappe.throw(f"Failed to update fields. Error: {str(e)}")

			try:
				employee.save()
			except Exception as e:
				frappe.throw(f"Failed to save the Employee record. Error: {str(e)}")

			try:
				employee.add_comment(
					"Info",
					"Employee data updated through the system using the Employee Data Update."
				)
			except Exception as e:
				frappe.throw(f"Failed to add a comment to the Employee record. Error: {str(e)}")

			frappe.msgprint(f"Employee data for {self.employee_name} has been successfully updated.")

		except Exception as e:
			frappe.throw(f"An error occurred while updating the employee data: {str(e)}")

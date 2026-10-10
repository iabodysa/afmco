import frappe


def check_iqama_expiration():
    today = frappe.utils.getdate()

    try:
        employees = frappe.get_all(
            "Employee",
            fields=["name", "iqama_expiration_date", "iqama_expired", "status", "corporation"]
        )

        errors = []

        for employee in employees:
            try:
                expired = 0

                if employee.status == "Active" and employee.corporation and employee.iqama_expiration_date:
                    expiration_date = frappe.utils.getdate(employee.iqama_expiration_date)

                    if expiration_date < today:
                        expired = 1

                if employee.iqama_expired != expired:
                    frappe.db.set_value("Employee", employee.name, "iqama_expired", expired, update_modified=False)

            except Exception as emp_error:
                errors.append(f"Error processing Employee {employee.name}: {str(emp_error)}")

        if errors:
            frappe.log_error("\n".join(errors), "Iqama Expiration Check Errors")

    except Exception as e:
        frappe.log_error(f"General error during iqama expiration check: {str(e)}", "Iqama Expiration Check General Error")

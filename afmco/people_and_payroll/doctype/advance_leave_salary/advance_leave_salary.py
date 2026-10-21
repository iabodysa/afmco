# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from afmco.people_and_payroll.advance_leave_salary import (
    APPROVED,
    follow_status_switch,
    recompute_advance,
    refuse_settled_employee,
    refuse_unearned_rows,
    refuse_unfinished_contract_year,
)


class AdvanceLeaveSalary(Document):
    def validate(self):
        if self.has_value_changed("employee"):
            refuse_settled_employee(self)
        recompute_advance(self)
        follow_status_switch(self)
        refuse_unearned_rows(self)
        if self.workflow_state == APPROVED and self.has_value_changed("workflow_state"):
            refuse_unfinished_contract_year(self)

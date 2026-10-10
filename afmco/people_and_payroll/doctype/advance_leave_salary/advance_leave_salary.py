# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from afmco.people_and_payroll.advance_leave_salary import (
    APPROVED,
    recompute_advance,
    refuse_unfinished_contract_year,
    refuse_unpaid_settled_period,
)


class AdvanceLeaveSalary(Document):
    def validate(self):
        recompute_advance(self)
        if self.workflow_state == APPROVED and self.has_value_changed("workflow_state"):
            refuse_unfinished_contract_year(self)

    def before_submit(self):
        refuse_unpaid_settled_period(self)

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from afmco.approver_check import engine

from afmco.people_and_payroll.advance_leave_salary import (
    APPROVED,
    recompute_advance,
    refuse_settled_employee,
    refuse_unfinished_contract_year,
    refuse_unpaid_settled_period,
)


class AdvanceLeaveSalary(Document):
    def onload(self):
        engine.set_onload(self)

    def approver_checklist(self, deferred: bool = False) -> dict:
        return engine.run(self, deferred=deferred)

    def validate(self):
        if self.has_value_changed("employee"):
            refuse_settled_employee(self)
        recompute_advance(self)
        if self.workflow_state == APPROVED and self.has_value_changed("workflow_state"):
            refuse_unfinished_contract_year(self)

    def before_submit(self):
        refuse_unpaid_settled_period(self)

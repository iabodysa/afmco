# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from afmco.approver_check import engine

from afmco.people_and_payroll.advance_leave_salary import (
    recompute_advance,
    refuse_unpaid_settled_period,
)


class AdvanceLeaveSalary(Document):
    def onload(self):
        self.set_onload("approver_check_allowed", engine.approver_allowed(self))

    def approver_checklist(self, deferred: bool = False) -> dict:
        return engine.run(self, deferred=deferred)

    def validate(self):
        recompute_advance(self)

    def before_submit(self):
        refuse_unpaid_settled_period(self)

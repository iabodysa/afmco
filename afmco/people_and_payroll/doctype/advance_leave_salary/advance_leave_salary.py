# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from frappe.model.document import Document

from afmco.people_and_payroll.vacation_allowance import (
    recompute_advance,
    refuse_unpaid_settled_period,
)


class AdvanceLeaveSalary(Document):
    def validate(self):
        recompute_advance(self)

    def before_submit(self):
        refuse_unpaid_settled_period(self)

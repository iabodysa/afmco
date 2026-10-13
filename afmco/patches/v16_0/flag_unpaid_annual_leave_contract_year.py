import frappe
from frappe.modules.utils import sync_customizations

LEAVE_TYPE = "Unpaid Annual Leave"
FIELD = "extends_contract_year"


def execute():
	if not frappe.db.exists("Leave Type", LEAVE_TYPE):
		return
	if not frappe.db.has_column("Leave Type", FIELD):
		sync_customizations("afmco")
	frappe.db.set_value("Leave Type", LEAVE_TYPE, FIELD, 1, update_modified=False)
	print(f"{LEAVE_TYPE}: {FIELD} set on {frappe.db.count('Leave Type', {FIELD: 1})} leave type(s)")

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json
from pathlib import Path
from unittest import TestCase

DOCTYPE_JSON = (
	Path(__file__).resolve().parent / "doctype" / "payment_requisition" / "payment_requisition.json"
)

FLAGS = (
	"permlevel",
	"if_owner",
	"select",
	"read",
	"write",
	"create",
	"delete",
	"submit",
	"cancel",
	"amend",
	"report",
	"export",
	"import",
	"share",
	"print",
	"email",
)

EXPECTED = {
	"Accountant": (0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 0),
	"Accountant Bot": (0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
	"Auditor": (0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0),
	"Bank User": (0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0),
	"Desk User": (0, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0),
	"General Manager": (0, 0, 1, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1),
	"HR Manager": (0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
	"Projects Manager": (0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0),
	"System Manager": (0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1),
}


def shipped_permissions(path=DOCTYPE_JSON):
	perms = json.loads(path.read_text(encoding="utf-8"))["permissions"]
	return [(p["role"], tuple(int(p.get(flag) or 0) for flag in FLAGS)) for p in perms]


class TestPaymentRequisitionPermissions(TestCase):
	def test_doctype_json_permissions_equal_production_docperm_without_request_user_or_invalid_flags(self):
		shipped = shipped_permissions()
		self.assertEqual(len(shipped), len({role for role, _ in shipped}))
		self.assertEqual(dict(shipped), EXPECTED)

	def test_request_user_holds_no_payment_requisition_permission(self):
		self.assertNotIn("Request User", dict(shipped_permissions()))

	def test_no_role_holds_import_without_allow_import_or_cancel_without_submit(self):
		doctype = json.loads(DOCTYPE_JSON.read_text(encoding="utf-8"))
		for role, flags in shipped_permissions():
			perm = dict(zip(FLAGS, flags))
			if not doctype.get("allow_import"):
				self.assertEqual(perm["import"], 0, role)
			if not perm["submit"]:
				self.assertEqual(perm["cancel"], 0, role)

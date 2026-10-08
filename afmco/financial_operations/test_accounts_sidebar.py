# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import glob
import json
import os

from frappe.tests import UnitTestCase

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RECEIVABLE_AND_PAYABLE = {("Report", "Accounts Receivable"), ("Report", "Accounts Payable")}


def read_json(path):
	with open(path) as f:
		return json.load(f)


def accounts_site_layer():
	layers = read_json(os.path.join(APP_ROOT, "fixtures", "custom_sidebar.json"))
	return next(layer for layer in layers if layer["module"] == "Accounts" and not layer["user"])


def shipped_accounts_sidebars():
	paths = glob.glob(os.path.join(APP_ROOT, "sidebar", "*", "*.json"))
	return [sidebar for sidebar in map(read_json, paths) if sidebar["module"] == "Accounts"]


def hidden_links(layer):
	return {(row["link_type"], row["link_to"]) for row in layer["sidebar_items"] if row["hidden"]}


class TestAccountsSiteSidebar(UnitTestCase):
	def test_site_layer_hides_every_dashboard_row_of_the_accounts_sidebars(self):
		hidden = hidden_links(accounts_site_layer())
		dashboards = {
			(row["link_type"], row["link_to"])
			for sidebar in shipped_accounts_sidebars()
			for row in sidebar["items"]
			if row.get("link_type") == "Dashboard"
		}
		self.assertTrue(dashboards)
		self.assertLessEqual(dashboards, hidden)
		self.assertIn(("Dashboard", "Accounts"), hidden)

	def test_site_layer_keeps_receivable_and_payable_visible(self):
		self.assertFalse(hidden_links(accounts_site_layer()) & RECEIVABLE_AND_PAYABLE)
		for name in ("payments", "invoicing"):
			sidebar = read_json(os.path.join(APP_ROOT, "sidebar", name, f"{name}.json"))
			shown = {(row.get("link_type"), row.get("link_to")) for row in sidebar["items"] if not row.get("hidden")}
			self.assertLessEqual(RECEIVABLE_AND_PAYABLE, shown, name)

	def test_site_layer_only_hides_rows_and_adds_none(self):
		layer = accounts_site_layer()
		self.assertTrue(all(row["hidden"] and not row["added"] for row in layer["sidebar_items"]))
		self.assertFalse(layer["label"] or layer["header_icon"])

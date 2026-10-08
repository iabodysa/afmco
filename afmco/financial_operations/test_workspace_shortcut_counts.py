# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import copy
import json
from pathlib import Path
from unittest import TestCase

APP = Path(__file__).resolve().parents[1]
WORKSPACES = sorted(APP.glob("*/workspace/*/*.json"))


def cleanup_filters(filters):
	if isinstance(filters, list) and len(filters) and len(filters[0]) == 5:
		filters.pop()
		return filters
	return filters


def shortcut_filters():
	for path in WORKSPACES:
		for shortcut in json.loads(path.read_text(encoding="utf-8")).get("shortcuts") or []:
			raw = (shortcut.get("stats_filter") or "").strip()
			if raw:
				yield path.name, shortcut["label"], json.loads(raw)


class TestWorkspaceShortcutCounts(TestCase):
	def test_journal_entry_shortcut_counts_drafts_only_after_frappe_cleanup_filters(self):
		journal_entry = next(
			f for name, label, f in shortcut_filters()
			if name == "financial_operations.json" and label == "Journal Entry"
		)
		self.assertEqual(cleanup_filters(journal_entry), [["Journal Entry", "docstatus", "=", "0"]])

	def test_every_shortcut_stats_filter_keeps_all_conditions_through_frappe_cleanup_filters(self):
		checked = 0
		for name, label, filters in shortcut_filters():
			checked += 1
			with self.subTest(workspace=name, shortcut=label):
				self.assertEqual(cleanup_filters(copy.deepcopy(filters)), filters)
		self.assertGreaterEqual(checked, 5)

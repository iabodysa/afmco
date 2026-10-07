# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json

import frappe

FLEET_TARGETS = (
	"Vehicle",
	"Driver",
	"Vehicle Log",
	"Vehicle Service Item",
	"Vehicle Expenses",
)
FLEET_CARD = "Fleet Management"


def public_parents(child_doctype, parent_doctype, filters):
	parents = frappe.get_all(
		child_doctype, filters={**filters, "parenttype": parent_doctype}, pluck="parent"
	)
	return frappe.get_all(
		parent_doctype,
		filters={"name": ("in", sorted(set(parents))), "for_user": ("is", "not set")},
		pluck="name",
	)


def is_fleet_link(row):
	if row.type == "Card Break":
		return row.label == FLEET_CARD
	return row.link_to in FLEET_TARGETS


def recount_cards(links):
	card = None
	for row in links:
		if row.type == "Card Break":
			card = row
			card.link_count = 0
		elif card:
			card.link_count += 1


def remove_from_boot_sidebars(bootinfo):
	sidebars = bootinfo.module_sidebars or bootinfo.workspace_sidebar_item or {}
	for sidebar in sidebars.values():
		sidebar["items"] = [item for item in sidebar["items"] if item.get("link_to") not in FLEET_TARGETS]


def remove_from_workspaces():
	link_filter = {"link_to": ("in", FLEET_TARGETS)}
	card_filter = {"type": "Card Break", "label": FLEET_CARD}
	names = set(public_parents("Workspace Link", "Workspace", link_filter))
	names.update(public_parents("Workspace Link", "Workspace", card_filter))
	for name in sorted(names):
		workspace = frappe.get_doc("Workspace", name)
		content = json.loads(workspace.content or "[]")
		workspace.content = json.dumps(
			[
				block
				for block in content
				if (block.get("data") or {}).get("card_name") != FLEET_CARD
			]
		)
		workspace.set(
			"links", [row for row in workspace.links if not is_fleet_link(row)]
		)
		recount_cards(workspace.links)
		workspace.save()

# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.utils import strip_html

WORKSPACE = "ZATCA"
WORKSPACE_MODULE = "KSA Compliance"
HEADER_TEXT = "Feedback and Links"
CUSTOM_BLOCK = "ZATCA Workspace - Feedback and Link Section"
SHORTCUT = "KSA Compliance Premium"


def is_promotion_block(block):
	data = block.get("data") or {}
	kind = block.get("type")
	if kind == "header":
		return strip_html(data.get("text") or "").strip() == HEADER_TEXT
	if kind == "custom_block":
		return data.get("custom_block_name") == CUSTOM_BLOCK
	if kind == "shortcut":
		return data.get("shortcut_name") == SHORTCUT
	return False


def without_promotion(content, custom_blocks, shortcuts):
	return (
		[block for block in content if not is_promotion_block(block)],
		[row for row in custom_blocks if row.get("custom_block_name") != CUSTOM_BLOCK],
		[row for row in shortcuts if row.get("label") != SHORTCUT],
	)


def remove_premium_promotion():
	if not frappe.db.exists("Workspace", {"name": WORKSPACE, "module": WORKSPACE_MODULE}):
		return

	workspace = frappe.get_doc("Workspace", WORKSPACE)
	content = json.loads(workspace.content or "[]")
	kept_content, kept_blocks, kept_shortcuts = without_promotion(
		content, workspace.custom_blocks, workspace.shortcuts
	)
	if (len(kept_content), len(kept_blocks), len(kept_shortcuts)) == (
		len(content),
		len(workspace.custom_blocks),
		len(workspace.shortcuts),
	):
		return

	if not workspace.type:
		workspace.type = "Workspace"
	workspace.content = json.dumps(kept_content)
	workspace.set("custom_blocks", kept_blocks)
	workspace.set("shortcuts", kept_shortcuts)
	workspace.save()

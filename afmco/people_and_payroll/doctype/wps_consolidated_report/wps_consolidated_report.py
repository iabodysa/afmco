# -*- coding: utf-8 -*-

from __future__ import annotations

import csv
import io
import json
import math
import zipfile
from datetime import datetime
from typing import Dict, List, Tuple

import frappe
from frappe import _
from frappe.model.document import Document

# -----------------------------------------------------------------------------
FILE_EXTENSIONS = {"CSV": "csv", "Excel": "xlsx"}

EMP_HEADERS_NCBK = [
    "Bank", "Account Number", "Total Salary", "Transaction Reference",
    "Employee Name", "National ID/Iqama ID", "Employee Address",
    "Basic Salary", "Housing Allowance", "Other Earnings", "Deductions",
]
EMP_HEADERS_SIBC = [
    "Employee", "First Name", "Middle Name", "Last Name", "Bank Name",
    "Bank Account No.", "Basic", "Housing", "Other Allowance", "Deduction",
    "Net Pay", "Remark",
]

CUSTOM_PE_FIELD = "wps_report_reference"     # Link field inside Payroll Entry
CSV_LIMIT        = 1_000                            # Batch size for SQL fetching
# -----------------------------------------------------------------------------


class WPSConsolidatedReport(Document):
    # ----------------------------------------------------------- Validation ----
    def validate(self) -> None:
        if not self.payroll_entries:
            frappe.throw(_("Please select at least one Payroll Entry"))

        if self.docstatus == 0:
            self._ensure_no_overlap()

    def _ensure_no_overlap(self) -> None:
        current = {row.payroll_entry for row in self.payroll_entries if row.payroll_entry}
        if not current:
            return

        existing = frappe.get_all(
            "WPS Consolidated Report",
            filters={"docstatus": 1, "name": ["!=", self.name]},
            fields=["name", "payroll_entries"],
        )
        for rec in existing:
            others = set(rec.payroll_entries.split(",")) if rec.payroll_entries else set()
            dupes = current.intersection(others)
            if dupes:
                frappe.throw(
                    _("Payroll Entry(ies) {0} already linked to report {1}")
                    .format(", ".join(dupes), rec.name)
                )

    # ------------------------------------------------------- Lifecycle events --
    def on_submit(self) -> None:
        self._generate()
        self.status = "Submitted"
        self.report_generated_at = frappe.utils.now()

    def on_cancel(self) -> None:
        self._clear_pe_links()
        
    def on_trash(self) -> None:
        self._clear_pe_links()

    # ------------------------------------------------------ Public API (RPC) --
    @frappe.whitelist()
    def generate_zip(self) -> dict:
        if self.docstatus != 0:
            frappe.throw(_("Only Draft documents can generate the ZIP"))
        return self._generate()

    @frappe.whitelist()
    def regenerate_zip(self) -> dict:
        if self.docstatus != 1:
            frappe.throw(_("Only Submitted documents can regenerate the ZIP"))
        return self._generate()

    @frappe.whitelist()
    def release_payroll_entries(self) -> dict:
        if "System Manager" not in frappe.get_roles():
            frappe.throw(_("Not permitted"), frappe.PermissionError)
        if self.docstatus != 1:
            frappe.throw(_("Only Submitted documents can release Payroll Entries"))
        entries = [row.payroll_entry for row in self.payroll_entries if row.payroll_entry]
        if not entries:
            frappe.msgprint(_("No Payroll Entries found to unlink."))
            return {"released": 0, "total": 0}
        released = 0
        for entry in entries:
            frappe.db.savepoint("afmco_wps_release")
            try:
                payroll_entry = frappe.get_doc("Payroll Entry", entry)
                payroll_entry.set(CUSTOM_PE_FIELD, None)
                payroll_entry.save()
            except Exception:
                frappe.db.rollback(save_point="afmco_wps_release")
                frappe.log_error(title=f"WPS release {entry}")
            else:
                released += 1
        return {"released": released, "total": len(entries)}

    # ----------------------------------------------------------- Main runner --
    def _generate(self) -> dict:
        try:
            slips = self._fetch_slips()
            if not slips:
                frappe.throw(_("No submitted Salary Slips found"))

            grouped = self._group_by_labor_office(slips)
            files, bat_blocks = self._build_files(grouped)

            if not files:
                frappe.throw(_("All Salary Slips have zero Net Pay – nothing to export."))

            self.cmd_script = self._build_bat_script(bat_blocks)
            
            # Bundle ZIP or save single file directly
            result = self._bundle_files(files, self.cmd_script)
            self._store_file(result)
            self._link_payroll_entries()

            # allow save after submit
            self.flags.ignore_validate_update_after_submit = True
            self.save()

            frappe.msgprint(_("WPS ZIP generated successfully with {0} file(s)").format(len(files)))
            return {"status": "success", "files_count": len(files)}

        except Exception as exc:
            frappe.log_error(f"WPS ZIP error: {exc}")
            frappe.throw(_("Failed to process ZIP file. Please check the logs."))

    # --------------------------------------------------- Salary Slip helpers --
    def _fetch_slips(self) -> List[dict]:
        pe_list = [row.payroll_entry for row in self.payroll_entries if row.payroll_entry]
        results: List[dict] = []

        for pe in pe_list:
            # First get the payroll entry to extract cost center
            pe_doc = frappe.get_doc("Payroll Entry", pe)
            cost_center = pe_doc.get("cost_center", "")
            
            start = 0
            while True:
                batch = frappe.get_all(
                    "Salary Slip",
                    filters={"payroll_entry": pe, "docstatus": 1},
                    fields=[
                        "name", "employee", "employee_name", "iban_holder_name", "payroll_entry",
                        "labor_office_file_number", "bank_name", "bank_account_no",
                        "basic33", "housing33", "other_allowance33", "deduction33",
                        "remark", "net_pay", "hold", "start_date", "end_date",
                        "company"
                    ],
                    limit_start=start,
                    limit_page_length=CSV_LIMIT,
                )
                
                # Add cost center to each slip for project name extraction
                for slip in batch:
                    slip["cost_center"] = cost_center
                    
                results.extend(batch)
                if len(batch) < CSV_LIMIT:
                    break
                start += CSV_LIMIT

        return results

    def _group_by_labor_office(self, slips: List[dict]) -> Dict[str, List[dict]]:
        grouped: Dict[str, List[dict]] = {}
        hold_slips: List[dict] = []
        
        # First pass: separate hold slips from regular slips
        for s in slips:
            # Check if this is a hold slip
            if s.get("hold") == 1:
                hold_slips.append(s)
                continue
                
            # Filter out zero-pay slips for regular files
            if not s.get("net_pay") or s["net_pay"] <= 0:
                continue
                
            # Regular slip - group by labor office
            key = s.get("labor_office_file_number") or "NO_LABOR_OFFICE"
            grouped.setdefault(key, []).append(s)
        
        # Add hold slips as a separate group if any exist
        if hold_slips:
            grouped["WPS_HOLD_FILE"] = hold_slips
            
        return grouped

    # --------------------------------------------------------- File builders --
    def _build_files(self, grouped: Dict[str, List[dict]]):
        files, bat_blocks = [], []
        index = 1

        for office, slips in grouped.items():
            # For regular files, filter out zero-pay slips (already done in grouping)
            # For hold file, keep all slips regardless of net pay
            if office != "WPS_HOLD_FILE":
                slips = [s for s in slips if s.get("net_pay") and s["net_pay"] > 0]
                if not slips:
                    continue

            # Calculate totals
            total_net = sum(s.get("net_pay", 0) for s in slips)
            total_net_floor = math.floor(total_net)
            
            # Get corporation info for CR number
            corporation = ""
            corporation_cr = ""
            
            # For regular files, try to get corporation info
            if office != "WPS_HOLD_FILE" and office != "NO_LABOR_OFFICE":
                try:
                    corps = frappe.get_all(
                        "Corporation",
                        filters=[["establishment_number", "=", office]],
                        fields=["name", "cr"],
                        limit=1
                    )
                    if corps:
                        corporation = corps[0].name
                        corporation_cr = corps[0].get("cr", "")
                except Exception as e:
                    frappe.log_error(f"Error fetching corporation for {office}: {e}")
            
            # Special handling for hold file
            is_hold_file = (office == "WPS_HOLD_FILE")
            
            # Generate filename using the new naming convention
            filename = self._generate_filename(
                office, corporation_cr, slips, total_net, is_hold_file
            )
            
            # Build file content
            headers, rows = self._build_matrix_rows(slips)
            content = self._make_csv(headers, rows) if self.file_type == "CSV" else self._make_xlsx(headers, rows)

            # Add file to list
            files.append(
                {
                    "filename": filename,
                    "content": content,
                    "labor_office_file_number": office if not is_hold_file else "WPS Hold File",
                    "employees_count": len(slips),
                    "total_net_pay": total_net,
                    "corporation": corporation,
                    "corporation_cr": corporation_cr,
                    "is_hold_file": is_hold_file,
                    "rows": rows,  # needed for BAT creation
                }
            )
            bat_blocks.append(self._bat_block_for_file(filename, rows))
            index += 1

        return files, bat_blocks

    def _generate_filename(self, office: str, corporation_cr: str, slips: List[dict], 
                          total_net: float, is_hold_file: bool) -> str:
        if is_hold_file:
            # Format: WPS_Hold_File_YYMMDD.csv
            today = datetime.now()
            return f"WPS_Hold_File_{today.strftime('%y%m%d')}.{FILE_EXTENSIONS[self.file_type]}"
        else:
            # Get date info from first slip
            end_date = slips[0].get("end_date") if slips else datetime.now()
            if isinstance(end_date, str):
                end_date = datetime.strptime(end_date, '%Y-%m-%d')
            elif not end_date:
                end_date = datetime.now()
                
            # Calculate halalas (hundreds column)
            halalas = str(int(round((total_net % 1) * 100))).zfill(2)
            
            # Get month abbreviation and year
            month_abbr = end_date.strftime('%b').upper()
            year_two_digit = end_date.strftime('%y')
            
            # Extract project name from cost center
            cost_center = slips[0].get("cost_center", "") if slips else ""
            project_name = ' - '.join([p.strip() for p in cost_center.split('-') if not any('\u0600' <= c <= '\u06FF' for c in p)][:2])
            
            # Format: <MOL_No> <CR> <EmployeeCount> <TotalAmount> <HundredsColumn> <ProjectName> <MonAbbr> <YY>.csv
            return f"{office} {corporation_cr} {len(slips)} {int(total_net)} {halalas} {project_name} {month_abbr} {year_two_digit}.{FILE_EXTENSIONS[self.file_type]}"
    
    def _build_matrix_rows(self, slips: List[dict]):
        if self.bank_format == "NCBK":
            headers = EMP_HEADERS_NCBK
            rows = [
                [
                    s.get("bank_name", ""),
                    s.get("bank_account_no", ""),
                    s.get("net_pay", ""),
                    s.get("remark", ""),
                    s.get("iban_holder_name") or s.get("employee_name", ""),
                    s.get("employee", ""),
                    "RUH",
                    s.get("basic33", ""),
                    s.get("housing33", ""),
                    s.get("other_allowance33", ""),
                    s.get("deduction33", ""),
                ]
                for s in slips
            ]
        else:  # SIBC
            headers = EMP_HEADERS_SIBC
            rows = []
            for s in slips:
                first, mid, last = self._split_name(s.get("iban_holder_name") or s.get("employee_name"))
                rows.append(
                    [
                        s.get("employee", ""),
                        first,
                        mid,
                        last,
                        s.get("bank_name", ""),
                        s.get("bank_account_no", ""),
                        s.get("basic33", ""),
                        s.get("housing33", ""),
                        s.get("other_allowance33", ""),
                        s.get("deduction33", ""),
                        s.get("net_pay", ""),
                        s.get("remark", ""),
                    ]
                )
        return headers, rows

    # --------------------------------------------------------- Row utilities -
    @staticmethod
    def _split_name(full: str | None):
        if not full:
            return "-", "-", "-"
        parts = full.strip().split()
        first = parts[0] if parts else "-"
        last = parts[-1] if len(parts) > 1 else "-"
        mid = " ".join(parts[1:-1]) if len(parts) > 2 else (parts[1] if len(parts) > 1 else "-")
        return first, mid or "-", last or "-"

    # ------------------------------------------------------------- Writers ---
    @staticmethod
    def _make_csv(headers: list, rows: list) -> bytes:
        buf = io.StringIO()
        # Use utf-8-sig to add BOM for proper Excel display of Arabic text
        writer = csv.writer(buf)
        writer.writerows([headers] + rows)
        # Encode with UTF-8 BOM
        return buf.getvalue().encode("utf-8-sig")

    @staticmethod
    def _make_xlsx(headers: list, rows: list) -> bytes:
        from frappe.utils.xlsxutils import make_xlsx
        return make_xlsx([headers] + rows, "WPS").getvalue()

    # ----------------------------------------------------------- BAT helper -
    def _bat_block_for_file(self, filename: str, rows: List[list]) -> str:
        # Determine headers based on bank format
        headers = EMP_HEADERS_NCBK if self.bank_format == "NCBK" else EMP_HEADERS_SIBC
        header_line = ",".join(headers)
        
        commands = [
            f'echo Creating file: "%dir_name%\\{filename}"',
            f'echo {header_line} > "%dir_name%\\{filename}"',
        ]
        for r in rows:
            line = ",".join(f'"{v}"' for v in r)
            commands.append(f'echo {line} >> "%dir_name%\\{filename}"')
        return "\n".join(commands)

    def _build_bat_script(self, blocks: List[str]) -> str:
        pe_list = [row.payroll_entry for row in self.payroll_entries if row.payroll_entry]

        lines = [
            "@echo off",
            "setlocal enabledelayedexpansion",
            "",
            'set "dir_name=%~dp0\\%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"',
            'if not exist "%dir_name%" mkdir "%dir_name%"',
            "",
        ]
        lines.extend(blocks)
        lines.append("")
        lines.append(":: Copy generated files to each Payroll Entry folder")
        for pe in pe_list:
            lines.append(f'if not exist "%~dp0\\{pe}" mkdir "%~dp0\\{pe}"')
            lines.append(f'xcopy "%dir_name%\\*" "%~dp0\\{pe}\\" /Y >nul')
        lines.extend(["", "echo Done!", "pause"])
        return "\r\n".join(lines)

    # ------------------------------------------------------------- ZIP/Store -
    def _bundle_files(self, files: List[dict], bat_script: str) -> Tuple[io.BytesIO, str, bool]:
        # Handle single-file rule: if only one CSV is produced, return it directly
        if len(files) == 1 and self.file_type == "CSV":
            # Get the single file content as BytesIO
            single_file = files[0]
            content_buf = io.BytesIO()
            if isinstance(single_file["content"], str):
                content_buf.write(single_file["content"].encode('utf-8'))
            else:
                content_buf.write(single_file["content"])
            content_buf.seek(0)
            return content_buf, single_file["filename"], True  # Return buffer, filename, and single_file flag
        
        # Otherwise create a zip file for multiple files
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for f in files:
                z.writestr(f["filename"], f["content"])
            z.writestr("generate_wps_files.bat", bat_script.encode("utf-8"))
        buf.seek(0)
        zip_filename = f"WPS_Report_{self.name}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
        return buf, zip_filename, False  # Return buffer, filename, and single_file flag

    def _store_file(self, result: Tuple[io.BytesIO, str, bool]) -> None:
        content_buf, filename, is_single_file = result
        
        # Create the file document
        file_doc = frappe.get_doc(
            {
                "doctype": "File",
                "file_name": filename,
                "attached_to_doctype": self.doctype,
                "attached_to_name": self.name,
                "content": content_buf.read(),
                "is_private": 1,
            }
        ).insert(ignore_permissions=True)
        
        self.generated_zip_file = file_doc.file_url

    # ------------------------------------------------ Payroll Entry linking -
    def _link_payroll_entries(self) -> None:
        pe_names = [row.payroll_entry for row in self.payroll_entries if row.payroll_entry]
        if not pe_names:
            return
        frappe.db.sql(
            f"UPDATE `tabPayroll Entry` SET `{CUSTOM_PE_FIELD}` = %s "
            f"WHERE name IN ({', '.join(['%s'] * len(pe_names))})",
            [self.name] + pe_names,
        )

    def _clear_pe_links(self) -> None:
        pe_names = [row.payroll_entry for row in self.payroll_entries if row.payroll_entry]
        if not pe_names:
            return
        frappe.db.sql(
            f"UPDATE `tabPayroll Entry` SET `{CUSTOM_PE_FIELD}` = NULL "
            f"WHERE name IN ({', '.join(['%s'] * len(pe_names))}) "
            f"AND `{CUSTOM_PE_FIELD}` = %s",
            pe_names + [self.name],
        )

import json
import frappe
from frappe.model.document import Document


class FinancialAnalysisDashboard(Document):
	def validate(self):
		if frappe.flags.in_install or frappe.flags.in_migrate:
			return
		self.build_financial_analysis()

	def build_financial_analysis(self):
		def execute(self):

			company = self.company

			if not company:
				frappe.throw("Please specify a company")

			current_date = frappe.utils.nowdate()
			current_year = int(current_date.split('-')[0])
			current_month = int(current_date.split('-')[1])
			current_quarter = ((current_month - 1) // 3) + 1

			years_data = frappe.db.sql("""
        SELECT DISTINCT fiscal_year\x20
        FROM `tabGL Entry`\x20
        WHERE company = %s\x20
        AND is_cancelled = 0\x20
        AND docstatus = 1
        ORDER BY fiscal_year DESC
    """, company, as_list=True)

			available_years = [str(year[0]) for year in years_data if year[0] and str(year[0]).isdigit()]
			complete_years = [y for y in available_years if int(y) < current_year]
			complete_years.sort(reverse=True)

			accounts = frappe.db.sql("""
        SELECT\x20
            name as account,
            account_name,
            root_type
        FROM `tabAccount`
        WHERE\x20
            company = %s
            AND is_group = 0
            AND root_type IN ('Income', 'Expense')
        ORDER BY root_type, account_name
    """, company, as_dict=True)

			yearly_data = {}

			for year in complete_years:
				year_data = {
					"income": {},
					"expense": {},
					"total_income": 0,
					"total_expense": 0
				}

				for account in accounts:
					result = frappe.db.sql("""
                SELECT\x20
                    SUM(debit) as total_debit,
                    SUM(credit) as total_credit
                FROM `tabGL Entry`
                WHERE\x20
                    account = %s
                    AND company = %s
                    AND fiscal_year = %s
                    AND is_cancelled = 0
                    AND docstatus = 1
                    AND voucher_type != 'Period Closing Voucher'
            """, (account['account'], company, year), as_dict=True)

					if result and result[0]:
						debit = float(result[0].get('total_debit') or 0)
						credit = float(result[0].get('total_credit') or 0)

						if account['root_type'] == 'Income':
							balance = abs(credit - debit)
							if balance != 0:
								year_data['income'][account['account_name']] = balance
								year_data['total_income'] = year_data['total_income'] + balance
						else:
							balance = abs(debit - credit)
							if balance != 0:
								year_data['expense'][account['account_name']] = balance
								year_data['total_expense'] = year_data['total_expense'] + balance

				yearly_data[year] = year_data

			quarterly_data = {}

			for q in range(1, current_quarter + 1):
				quarter_key = f"Q{q}-{current_year}"

				start_month = (q - 1) * 3 + 1
				end_month = q * 3
				start_date = f"{current_year}-{start_month:02d}-01"

				if end_month == 12:
					end_date = f"{current_year}-12-31"
				else:
					if end_month in [1, 3, 5, 7, 8, 10, 12]:
						last_day = 31
					elif end_month in [4, 6, 9, 11]:
						last_day = 30
					else:
						if current_year % 4 == 0 and (current_year % 100 != 0 or current_year % 400 == 0):
							last_day = 29
						else:
							last_day = 28
					end_date = f"{current_year}-{end_month:02d}-{last_day:02d}"

				quarter_data = {
					"income": 0,
					"expense": 0,
					"details": {}
				}

				for account in accounts:
					result = frappe.db.sql("""
                SELECT\x20
                    SUM(debit) as total_debit,
                    SUM(credit) as total_credit
                FROM `tabGL Entry`
                WHERE\x20
                    account = %s
                    AND company = %s
                    AND posting_date BETWEEN %s AND %s
                    AND is_cancelled = 0
                    AND docstatus = 1
                    AND voucher_type != 'Period Closing Voucher'
            """, (account['account'], company, start_date, end_date), as_dict=True)

					if result and result[0]:
						debit = float(result[0].get('total_debit') or 0)
						credit = float(result[0].get('total_credit') or 0)

						if account['root_type'] == 'Income':
							amount = credit - debit
							if amount != 0:
								quarter_data['income'] = quarter_data['income'] + amount
								quarter_data['details'][account['account_name']] = amount
						else:
							amount = debit - credit
							if amount != 0:
								quarter_data['expense'] = quarter_data['expense'] + amount
								quarter_data['details'][account['account_name']] = amount

				quarterly_data[quarter_key] = quarter_data

			if current_quarter > 0 and str(current_year - 1) in available_years:
				prev_quarter_key = f"Q{current_quarter}-{current_year - 1}"

				start_month = (current_quarter - 1) * 3 + 1
				end_month = current_quarter * 3
				start_date = f"{current_year - 1}-{start_month:02d}-01"

				if end_month == 12:
					end_date = f"{current_year - 1}-12-31"
				else:
					if end_month in [1, 3, 5, 7, 8, 10, 12]:
						last_day = 31
					elif end_month in [4, 6, 9, 11]:
						last_day = 30
					else:
						if (current_year - 1) % 4 == 0 and ((current_year - 1) % 100 != 0 or (current_year - 1) % 400 == 0):
							last_day = 29
						else:
							last_day = 28
					end_date = f"{current_year - 1}-{end_month:02d}-{last_day:02d}"

				quarter_data = {
					"income": 0,
					"expense": 0,
					"details": {}
				}

				for account in accounts:
					result = frappe.db.sql("""
                SELECT\x20
                    SUM(debit) as total_debit,
                    SUM(credit) as total_credit
                FROM `tabGL Entry`
                WHERE\x20
                    account = %s
                    AND company = %s
                    AND posting_date BETWEEN %s AND %s
                    AND is_cancelled = 0
                    AND docstatus = 1
                    AND voucher_type != 'Period Closing Voucher'
            """, (account['account'], company, start_date, end_date), as_dict=True)

					if result and result[0]:
						debit = float(result[0].get('total_debit') or 0)
						credit = float(result[0].get('total_credit') or 0)

						if account['root_type'] == 'Income':
							amount = credit - debit
							if amount != 0:
								quarter_data['income'] = quarter_data['income'] + amount
								quarter_data['details'][account['account_name']] = amount
						else:
							amount = debit - credit
							if amount != 0:
								quarter_data['expense'] = quarter_data['expense'] + amount
								quarter_data['details'][account['account_name']] = amount

				quarterly_data[prev_quarter_key] = quarter_data

			all_quarters_data = []

			for prev_year in complete_years[:3]:
				year_int = int(prev_year)

				if year_int == current_year - 1:
					max_q = 4
				else:
					max_q = 4

				for q in range(1, max_q + 1):
					quarter_key = f"Q{q}-{year_int}"

					if quarter_key in quarterly_data:
						all_quarters_data.append({
							"quarter": quarter_key,
							"data": quarterly_data[quarter_key]
						})
					else:
						start_month = (q - 1) * 3 + 1
						end_month = q * 3
						start_date = f"{year_int}-{start_month:02d}-01"

						if end_month == 12:
							end_date = f"{year_int}-12-31"
						else:
							if end_month in [1, 3, 5, 7, 8, 10, 12]:
								last_day = 31
							elif end_month in [4, 6, 9, 11]:
								last_day = 30
							else:
								if year_int % 4 == 0 and (year_int % 100 != 0 or year_int % 400 == 0):
									last_day = 29
								else:
									last_day = 28
							end_date = f"{year_int}-{end_month:02d}-{last_day:02d}"

						quarter_data = {
							"income": 0,
							"expense": 0,
							"details": {}
						}

						for account in accounts:
							result = frappe.db.sql("""
                        SELECT\x20
                            SUM(debit) as total_debit,
                            SUM(credit) as total_credit
                        FROM `tabGL Entry`
                        WHERE\x20
                            account = %s
                            AND company = %s
                            AND posting_date BETWEEN %s AND %s
                            AND is_cancelled = 0
                            AND docstatus = 1
                            AND voucher_type != 'Period Closing Voucher'
                    """, (account['account'], company, start_date, end_date), as_dict=True)

							if result and result[0]:
								debit = float(result[0].get('total_debit') or 0)
								credit = float(result[0].get('total_credit') or 0)

								if account['root_type'] == 'Income':
									amount = credit - debit
									if amount != 0:
										quarter_data['income'] = quarter_data['income'] + amount
										quarter_data['details'][account['account_name']] = amount
								else:
									amount = debit - credit
									if amount != 0:
										quarter_data['expense'] = quarter_data['expense'] + amount
										quarter_data['details'][account['account_name']] = amount

						quarterly_data[quarter_key] = quarter_data
						all_quarters_data.append({
							"quarter": quarter_key,
							"data": quarter_data
						})

			all_quarters_data.sort(key=lambda x: (int(x["quarter"].split("-")[1]), int(x["quarter"][1])), reverse=True)
			last_4_quarters = all_quarters_data[:4]

			expense_comparisons = {}
			expense_accounts = {}

			for q_data in last_4_quarters:
				quarter_name = q_data["quarter"]
				quarter_details = q_data["data"]["details"]

				for account_name, amount in quarter_details.items():
					if account_name not in expense_accounts:
						expense_accounts[account_name] = {}
					expense_accounts[account_name][quarter_name] = amount

			for i in range(len(last_4_quarters) - 1):
				current_q = last_4_quarters[i]["quarter"]
				prev_q = last_4_quarters[i + 1]["quarter"]

				current_expense = last_4_quarters[i]["data"]["expense"]
				prev_expense = last_4_quarters[i + 1]["data"]["expense"]

				if prev_expense > 0:
					change_pct = ((current_expense - prev_expense) / prev_expense) * 100
				else:
					change_pct = 100.0 if current_expense > 0 else 0.0

				expense_comparisons[f"{current_q}_vs_{prev_q}"] = {
					"current_quarter": current_q,
					"previous_quarter": prev_q,
					"current_expense": current_expense,
					"previous_expense": prev_expense,
					"change_percent": round(change_pct, 1)
				}

			yearly_expense_changes = {}
			if len(complete_years) > 1:
				for i in range(len(complete_years) - 1):
					current_year = complete_years[i]
					previous_year = complete_years[i + 1]

					current_total = yearly_data[current_year]["total_expense"]
					previous_total = yearly_data[previous_year]["total_expense"]

					if previous_total > 0:
						change_pct = ((current_total - previous_total) / previous_total) * 100
					else:
						change_pct = 100.0 if current_total > 0 else 0.0

					yearly_expense_changes[f"{current_year}_vs_{previous_year}"] = {
						"current_year": current_year,
						"previous_year": previous_year,
						"current_expense": current_total,
						"previous_expense": previous_total,
						"change_percent": round(change_pct, 1)
					}

			financial_data = {
				"company": company,
				"current_year": current_year,
				"current_quarter": current_quarter,
				"complete_years": complete_years,
				"yearly_data": yearly_data,
				"quarterly_data": quarterly_data,
				"last_4_quarters": [q["quarter"] for q in last_4_quarters],
				"expense_comparisons": expense_comparisons,
				"expense_accounts": expense_accounts,
				"yearly_expense_changes": yearly_expense_changes,
				"last_updated": current_date
			}

			self.financial_data_snapshot = json.dumps(financial_data, ensure_ascii=False)
			self.save
			frappe.msgprint("Financial data updated successfully", alert=True)
			frappe.response['message'] = 'Success'

		execute(self)

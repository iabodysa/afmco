// Copyright (c) 2026, AFMCO and contributors
frappe.ui.form.off("Loan Restructure", "calculate_overdue_amounts");
frappe.ui.form.on("Loan Restructure", {
	calculate_overdue_amounts: function (frm) {
		frappe.call({
			method: "lending.loan_management.doctype.loan_repayment.loan_repayment.calculate_amounts",
			args: {
				against_loan: frm.doc.loan,
				posting_date: frm.doc.restructure_date,
				payment_type: "",
			},
			callback: function (r) {
				let amounts = r.message;
				frm.set_value("pending_principal_amount", amounts["pending_principal_amount"]);
				frm.set_value("total_overdue_amount", amounts["payable_amount"]);
				frm.set_value("principal_overdue", amounts["payable_principal_amount"]);
				frm.set_value("interest_overdue", amounts["interest_amount"]);
				frm.set_value("penalty_overdue", amounts["penalty_amount"]);
				frm.set_value("unaccrued_interest", amounts["unaccrued_interest"]);
				frm.set_value("available_security_deposit", amounts["available_security_deposit"]);
			},
		});
	},
});

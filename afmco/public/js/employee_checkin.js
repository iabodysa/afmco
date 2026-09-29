frappe.ui.form.on("Employee Checkin", {
	setup(frm) {
		frm.set_query("address", () => ({
			filters: { is_your_company_address: 1 },
		}));
	},
});

frappe.ui.form.on("Additional Salary", {
	setup(frm) {
		const core_query = frm.fields_dict.employee.get_query;
		frm.set_query("employee", () => {
			const query = core_query();
			query.filters.status = ["not in", ["Inactive", "Hold"]];
			return query;
		});
	},
});

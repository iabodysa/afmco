const report_error_handlers = frappe.ui.form
	.get_event_handler_list("Data Import", "show_report_error_button")
	.slice();

frappe.ui.form.off("Data Import", "show_report_error_button");

frappe.ui.form.on("Data Import", {
	show_report_error_button(frm) {
		if (!frappe.model.can_read("Error Log")) return;
		report_error_handlers.forEach((handler) => handler(frm));
	},
});

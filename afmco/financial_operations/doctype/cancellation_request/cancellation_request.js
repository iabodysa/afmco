frappe.ui.form.on('Cancellation Request', {
	refresh(frm) {
		if (frm.doc.journal_entry) {
			frm.add_custom_button(__('View Journal Entry'), function() {
				frappe.set_route('Form', 'Journal Entry', frm.doc.journal_entry);
			});
			let btn = frm.add_custom_button(__('Cancel Journal Entry'), function() {
				frappe.confirm(__('Are you sure you want to cancel the journal entry?', null, 'Cancellation Request'), function() {
					frappe.call({
						method: "frappe.client.cancel",
						args: {
							doctype: "Journal Entry",
							name: frm.doc.journal_entry
						},
						callback: function(r) {
							if (!r.exc) {
								frappe.msgprint(__('The journal entry was cancelled successfully', null, 'Cancellation Request'));
								frm.reload_doc();
							}
						}
					});
				});
			});
			$(btn).addClass("btn-danger");
		}
	}
});

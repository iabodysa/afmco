frappe.listview_settings['Expense Request Afmco'] = {
    onload: function(listview) {
        // Add button using official Frappe Page API
        let btn = listview.page.add_inner_button(__('Show Archive'), function() {
            frappe.call({
                method: "toggle_archive_view",
                freeze: true,
                freeze_message: __("Updating List..."),
                callback: function(r) {
                    if (r.message) {
                        let is_shown = r.message.show_archive;

                        // Toggle button text and standard Frappe UI classes
                        btn.text(is_shown ? __('Hide Archive') : __('Show Archive'));
                        btn.toggleClass('btn-warning', is_shown);
                        btn.toggleClass('btn-default', !is_shown);

                        // Official Frappe alert toast
                        frappe.show_alert({
                            message: is_shown ? __("Archived records displayed") : __("Archived records hidden"),
                            indicator: is_shown ? "green" : "orange"
                        });

                        // Standard Frappe ListView reset and refresh
                        listview.start = 0;
                        listview.refresh();
                    }
                }
            });
        });

        // Set default style class
        btn.addClass('btn-default');
    },

    refresh: function(listview) {
        // Native row styling using Frappe CSS variables
        listview.data.forEach(function(doc) {
            try {
                const row = $(`[data-name="${doc.name}"]`).closest('.list-row-container');
                if (row.length && doc.if_it__urgent == 1) {
                    row.find('a').css('color', 'var(--text-color-danger, #e64942)');
                }
            } catch (e) {
                console.error("Error styling list row", e);
            }
        });
    }
};
frappe.ui.form.on('Purchase Invoice', {
    refresh: function(frm) {
        frm.add_custom_button(__('Create Assets'), function() {
            open_asset_creation_dialog(frm);
        });
    }
});
function open_asset_creation_dialog(frm) {
    const asset_items = frm.doc.items.filter(item => item.custom_it_asset);

    if (asset_items.length === 0) {
        frappe.msgprint(__('No items are marked as assets. Please check the items and mark them as assets if needed.'));
        return;
    }

    let message = `<p>${__('The following items are marked as assets. Do you want to create assets for them?')}</p><ul>`;
    asset_items.forEach(item => {
        message += `<li>${item.item_name} - ${item.amount} ${frm.doc.currency} (Qty: ${item.qty})</li>`;
    });
    message += '</ul>';

    frappe.confirm(
        message,
        function() {
            create_assets_from_items(frm, asset_items);
        },
        function() {
            frappe.msgprint(__('Asset creation cancelled.'));
        }
    );
}
function create_assets_from_items(frm, asset_items) {
    let assets_created = 0;
    let errors = [];
    let created_assets = [];

    asset_items.forEach(item => {
        for (let i = 0; i < item.qty; i++) {
            const assetData = {
                doctype: 'IT Asset',
                asset_name: item.item_name + ' ' + (i + 1), // Unique asset name
                item_code: item.item_code,
                asset_category: item.asset_category || '',
                purchase_date: frm.doc.posting_date,
                location: "المركز الرئيسي",
                gross_purchase_amount: item.amount,
                fixed_asset_account: "116004 - الاجهزة والكمبيوترات والطابعات - Devices, computers and printers - AF", 
                cost_center: "الادارة رئيسي - Head Office - AF",          
                depreciation_expense_account: "538001 - م - اهلاك الاصول الثابتة - M - Depreciation of fixed assets - AF", 
                accumulated_depreciation_account: "213001 - مجمع اهلاك اصول الثابتة - Accumulated depreciation of fixed assets - AF" 
            };

            frappe.call({
                method: 'frappe.client.insert',
                args: { doc: assetData },
                callback: function(response) {
                    if (response && response.message) {
                        assets_created++;
                        created_assets.push(response.message); // Store created asset's name
                        frappe.msgprint(__('Asset created for Item: ') + item.item_name);
                    }
                },
                error: function(err) {
                    console.error("Error creating Asset:", err);
                    errors.push(item.item_name);
                    frappe.msgprint(__('Failed to create Asset for Item: ') + item.item_name);
                }
            });
        }
    });


    frappe.after_ajax(function() {
        validate_created_assets(created_assets);
        
        if (errors.length > 0) {
            frappe.msgprint(__('Assets created successfully, but the following items failed: ') + errors.join(', '));
        } else if (assets_created > 0) {
            frappe.msgprint(__('All assets created successfully!'));
        }
    });
}

function validate_created_assets(created_assets) {
    let validation_errors = [];

    created_assets.forEach(asset => {
     
        if (!asset || asset.length < 5) {
            validation_errors.push(asset);
        }

      
    });

    if (validation_errors.length > 0) {
        frappe.msgprint(__('The following created assets failed validation: ') + validation_errors.join(', '));
    } else {
        frappe.msgprint(__('All created assets passed validation!'));
    }
}

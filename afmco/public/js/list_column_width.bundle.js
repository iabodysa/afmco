// Copyright (c) 2026, AFMCO and contributors
// For license information, please see license.txt

(() => {
    const proto = frappe.views?.ListView?.prototype;
    const save = proto?.save_column_width;
    if (typeof save !== 'function') return;
    proto.save_column_width = function (...args) {
        if (!frappe.model.can_write('List View Settings')) return;
        return save.apply(this, args);
    };
})();

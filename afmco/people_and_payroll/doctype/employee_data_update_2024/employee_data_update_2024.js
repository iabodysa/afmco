frappe.ui.form.on('Employee Data Update 2024', {
    refresh: function(frm) {
        updateStatusLabels(frm);
        hideDisabledCheckbox(frm);
        if (frm.doc.a === 0) {
            frm.add_custom_button(__('Verify Department', null, 'Employee Data Update 2024'), async function() {
                let departmentValidated = await validateDepartment(frm);
                if (departmentValidated) {
                    frm.set_value('a', 1);
                    frm.save();
                }
            });
        }
        if (frm.doc.a === 1 && frm.doc.b === 0) {
            frm.add_custom_button(__('Verify Designation', null, 'Employee Data Update 2024'), async function() {
                let designationValidated = await validateDesignation(frm);
                if (designationValidated) {
                    frm.set_value('b', 1);
                    frm.save();
                }
            });
        }
        if (frm.doc.a === 1 && frm.doc.b === 1) {
            frm.add_custom_button('Fetch & Compare Employee Data', function() {
                if (frm.doc.employee) {
                    frappe.call({
                        method: "frappe.client.get",
                        args: {
                            doctype: "Employee",
                            name: frm.doc.employee
                        },
                        callback: function(r) {
                            if (r.message) {
                                let employee_data = r.message;
                                let getValue = (value) => value ? value : '<span style="color: red;">Not Available</span>';
                                let comparisonRows = "";
                                if (frm.doc.employee_name !== employee_data.employee_name) {
                                    comparisonRows += generateRow("Employee Name", getValue(frm.doc.employee_name), getValue(employee_data.employee_name));
                                }
                                if (frm.doc.date_of_birth !== employee_data.date_of_birth) {
                                    comparisonRows += generateRow("Date of Birth", getValue(frm.doc.date_of_birth), getValue(employee_data.date_of_birth));
                                }
                                if (frm.doc.nationality !== employee_data.nationality) {
                                    comparisonRows += generateRow("Nationality", getValue(frm.doc.nationality), getValue(employee_data.nationality));
                                }
                                if (frm.doc.company !== employee_data.company) {
                                    comparisonRows += generateRow("Company", getValue(frm.doc.company), getValue(employee_data.company));
                                }
                                if (frm.doc.department !== employee_data.department) {
                                    comparisonRows += generateRow("Department", getValue(frm.doc.department), getValue(employee_data.department));
                                }
                                if (frm.doc.designation !== employee_data.designation) {
                                    comparisonRows += generateRow("Designation", getValue(frm.doc.designation), getValue(employee_data.designation));
                                }
                                if (frm.doc.cell_number !== employee_data.cell_number) {
                                    comparisonRows += generateRow("Cell Number", getValue(frm.doc.cell_number), getValue(employee_data.cell_number));
                                }
                                if (frm.doc.personal_email !== employee_data.personal_email) {
                                    comparisonRows += generateRow("Personal Email", getValue(frm.doc.personal_email), getValue(employee_data.personal_email));
                                }
                                if (frm.doc.company_email !== employee_data.company_email) {
                                    comparisonRows += generateRow("Company Email", getValue(frm.doc.company_email), getValue(employee_data.company_email));
                                }
                                if (frm.doc.prefered_contact_email !== employee_data.prefered_contact_email) {
                                    comparisonRows += generateRow("Preferred Contact Email", getValue(frm.doc.prefered_contact_email), getValue(employee_data.prefered_contact_email));
                                }
                                if (frm.doc.current_address !== employee_data.current_address) {
                                    comparisonRows += generateRow("Current Address", getValue(frm.doc.current_address), getValue(employee_data.current_address));
                                }
                                if (frm.doc.permanent_address !== employee_data.permanent_address) {
                                    comparisonRows += generateRow("Permanent Address", getValue(frm.doc.permanent_address), getValue(employee_data.permanent_address));
                                }
                                if (frm.doc.person_to_be_contacted !== employee_data.person_to_be_contacted) {
                                    comparisonRows += generateRow("Emergency Contact Person", getValue(frm.doc.person_to_be_contacted), getValue(employee_data.person_to_be_contacted));
                                }
                                if (frm.doc.emergency_phone_number !== employee_data.emergency_phone_number) {
                                    comparisonRows += generateRow("Emergency Phone Number", getValue(frm.doc.emergency_phone_number), getValue(employee_data.emergency_phone_number));
                                }
                                if (frm.doc.relation !== employee_data.relation) {
                                    comparisonRows += generateRow("Relation", getValue(frm.doc.relation), getValue(employee_data.relation));
                                }
                                if (frm.doc.bank_name !== employee_data.bank_name) {
                                    comparisonRows += generateRow("Bank Name", getValue(frm.doc.bank_name), getValue(employee_data.bank_name));
                                }
                                if (frm.doc.bank_ac_no !== employee_data.bank_ac_no) {
                                    comparisonRows += generateRow("Bank Account Number", getValue(frm.doc.bank_ac_no), getValue(employee_data.bank_ac_no));
                                }
                                if (frm.doc.marital_status !== employee_data.marital_status) {
                                    comparisonRows += generateRow("Marital Status", getValue(frm.doc.marital_status), getValue(employee_data.marital_status));
                                }
                                if (frm.doc.family_background !== employee_data.family_background) {
                                    comparisonRows += generateRow("Family Background", getValue(frm.doc.family_background), getValue(employee_data.family_background));
                                }
                                if (frm.doc.blood_group !== employee_data.blood_group) {
                                    comparisonRows += generateRow("Blood Group", getValue(frm.doc.blood_group), getValue(employee_data.blood_group));
                                }
                                if (frm.doc.health_details !== employee_data.health_details) {
                                    comparisonRows += generateRow("Health Details", getValue(frm.doc.health_details), getValue(employee_data.health_details));
                                }
                                if (frm.doc.bio !== employee_data.bio) {
                                    comparisonRows += generateRow("Bio", getValue(frm.doc.bio), getValue(employee_data.bio));
                                }
                                if (comparisonRows) {
                                    let comparison = `
                                    <div style="background-color:#fff; padding:25px; border-radius:15px; box-shadow:0 10px 20px rgba(0, 0, 0, 0.2); font-family:Arial, sans-serif;">
                                        <h3 style="text-align:center; color:#333; font-size:24px; margin-bottom: 30px;">📊 Employee Data Comparison</h3>
                                        <table style="width:100%; border-collapse:collapse; text-align:left; font-size:16px;">
                                            <thead style="background-color:#4CAF50; color:white;">
                                                <tr style="border-bottom:2px solid #ddd;">
                                                    <th style="padding:15px; text-align:left;">Field</th>
                                                    <th style="padding:15px; text-align:left;">Document</th>
                                                    <th style="padding:15px; text-align:left;">Employee</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${comparisonRows}
                                            </tbody>
                                        </table>
                                    </div>
                                `;
                                    frm.set_value('data', comparison);
                                    frm.save_or_update();
                                } else {
                                    frappe.msgprint(__('No differences found between the document and employee data.'));
                                }
                            } else {
                                frappe.msgprint(__('Employee data could not be fetched. Please try again.'));
                            }
                        },
                        error: function(err) {
                            frappe.msgprint(__('An error occurred while fetching Employee data. Please try again.'));
                            console.error(err);
                        }
                    });
                } else {
                    frappe.msgprint(__('Please select an Employee to compare.'));
                }
            });
        }
    },
    onload: function(frm) {
        updateStatusLabels(frm);
        hideDisabledCheckbox(frm);
    }
});
function updateStatusLabels(frm) {
    if (frm.doc.a === 1) {
        frm.set_df_property('a', 'label', __('Department Verified', null, 'Employee Data Update 2024'));
    } else {
        frm.set_df_property('a', 'label', __('Department Not Verified', null, 'Employee Data Update 2024'));
    }
    if (frm.doc.b === 1) {
        frm.set_df_property('b', 'label', __('Designation Verified', null, 'Employee Data Update 2024'));
    } else {
        frm.set_df_property('b', 'label', __('Designation Not Verified', null, 'Employee Data Update 2024'));
    }
    frm.refresh_field('a');
    frm.refresh_field('b');
}
function hideDisabledCheckbox(frm) {
    const checkboxes = document.querySelectorAll('input[type="checkbox"].disabled-deselected');
    checkboxes.forEach(function(checkbox) {
        checkbox.style.display = 'none';
    });
}
function generateRow(field, docValue, empValue) {
    return `
        <tr style="border-bottom:1px solid #ddd;">
            <td style="padding:12px;">${field}</td>
            <td style="padding:12px; background-color:#f1f1f1; border-radius:8px;">${docValue}</td>
            <td style="padding:12px; background-color:#f9f9f9; border-radius:8px;">${empValue}</td>
        </tr>
    `;
}
async function validateDepartmentAndDesignation(frm) {
    let departmentValidated = await validateDepartment(frm);
    if (departmentValidated) {
        await validateDesignation(frm);
    }
}
async function validateDepartment(frm) {
    let departmentCheck = await frappe.call({
        method: "frappe.client.get_value",
        args: {
            doctype: "Department",
            filters: {
                name: frm.doc.department
            },
            fieldname: "name"
        }
    });
    if (departmentCheck.message && departmentCheck.message.name) {
        return true;
    } else {
        let departments = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Department",
                fields: ["name"],
                limit_page_length: 100
            }
        });
        let options = departments.message.map(dep => ({
            label: dep.name,
            value: dep.name
        }));
        await showPopup(frm, "department", __('Department', null, 'Employee Data Update 2024'), options, frm.doc.department);
        return false;
    }
}
async function validateDesignation(frm) {
    let designationCheck = await frappe.call({
        method: "frappe.client.get_value",
        args: {
            doctype: "Designation",
            filters: {
                name: frm.doc.designation
            },
            fieldname: "name"
        }
    });
    if (designationCheck.message && designationCheck.message.name) {
        return true;
    } else {
        let designations = await frappe.call({
            method: "frappe.client.get_list",
            args: {
                doctype: "Designation",
                fields: ["name"],
                limit_page_length: 100
            }
        });
        let options = designations.message.map(desig => ({
            label: desig.name,
            value: desig.name
        }));
        await showPopup(frm, "designation", __('Designation', null, 'Employee Data Update 2024'), options, frm.doc.designation);
        return false;
    }
}
function showPopup(frm, fieldname, fieldlabel, options, current_value) {
    return new Promise((resolve) => {
        const dialog = new frappe.ui.Dialog({
            title: __('{0} is invalid', [fieldlabel], 'Employee Data Update 2024'),
            fields: [{
                fieldtype: 'Select',
                label: __('Select a new {0}', [fieldlabel], 'Employee Data Update 2024'),
                options: options,
                fieldname: 'new_value',
                default: current_value,
                reqd: 1
            }, {
                fieldtype: 'HTML',
                options: `<div style="color: red;">${__('The current value ({0}) does not exist in the system. Please select another value.', [current_value], 'Employee Data Update 2024')}</div>`
            }],
            primary_action_label: __('Update', null, 'Employee Data Update 2024'),
            primary_action: function(data) {
                frm.set_value(fieldname, data.new_value);
                dialog.hide();
                resolve(true);
            }
        });
        dialog.show();
    });
}
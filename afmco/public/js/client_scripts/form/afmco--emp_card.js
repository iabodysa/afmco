frappe.ui.form.on('Employee', {
    refresh: function(frm) {
        frm.page.add_menu_item(__('Download Employee Card'), function() {
            generate_employee_card(frm);
        });
    }
});

function generate_employee_card(frm) {
    if (!frm.doc.id_number_cf) {
        frappe.prompt([
            {
                fieldname: 'employee_id',
                label: 'Employee ID',
                fieldtype: 'Data',
                reqd: 1,
                description: 'Please enter the Employee ID to generate the card'
            }
        ], 
        function(values) {
            frm.set_value('id_number_cf', values.employee_id);
            frm.save().then(() => {
                create_card_image(frm);
            });
        }, 
        'Enter Employee ID', 
        'Generate Card'
        );
        return;
    }
    
    create_card_image(frm);
}

function create_card_image(frm) {
    let canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d');
    
    // Professional ID card dimensions
    canvas.width = 420;
    canvas.height = 660;
    
    // Background - clean white
    ctx.fillStyle = '#F8F5EE';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw geometric pattern background
    drawGeometricPattern(ctx);
    
    // Main card area with rounded corners
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, 30, 30, 360, 600, 20);
    ctx.fill();
    
    // Header accent bar
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, 30, 30, 360, 120, [20, 20, 0, 0]);
    ctx.fill();
    
    // Add green accent stripe at bottom of header
    ctx.fillStyle = '#00844E';
    ctx.fillRect(30, 140, 360, 10);
    
    // Load and draw elements
    let logoImg = new Image();
    logoImg.crossOrigin = 'anonymous';
    logoImg.onload = function() {
        // Logo on white background
        ctx.drawImage(logoImg, 160, 55, 100, 50);
        continueCardCreation();
    };
    logoImg.onerror = function() {
        // Company name if no logo
        ctx.fillStyle = '#072B1A';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('COMPANY', 210, 85);
        continueCardCreation();
    };
    logoImg.src = 'https://afmco.sa/files/Logo-01.png';
    
    function continueCardCreation() {
        // Employee photo section
        let employeeImg = new Image();
        employeeImg.crossOrigin = 'anonymous';
        employeeImg.onload = function() {
            drawModernLayout(ctx, employeeImg, frm);
            saveCanvasAsAttachment(canvas, frm);
        };
        employeeImg.onerror = function() {
            drawModernLayout(ctx, null, frm);
            saveCanvasAsAttachment(canvas, frm);
        };
        employeeImg.src = frm.doc.image || 'https://afmco.sa/files/avatar.jpg';
    }
}

function drawGeometricPattern(ctx) {
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    
    // Hexagonal pattern in background
    for(let y = 0; y < 660; y += 60) {
        for(let x = 0; x < 420; x += 52) {
            let offsetX = (y / 60) % 2 === 0 ? 0 : 26;
            drawHexagon(ctx, x + offsetX, y, 25);
        }
    }
    ctx.globalAlpha = 1;
}

function drawHexagon(ctx, x, y, size) {
    ctx.beginPath();
    for(let i = 0; i < 6; i++) {
        let angle = (Math.PI / 3) * i;
        let px = x + size * Math.cos(angle);
        let py = y + size * Math.sin(angle);
        if(i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
}

function drawModernLayout(ctx, img, frm) {
    // Circular photo frame
    let photoX = 210;
    let photoY = 250;
    let photoRadius = 80;
    
    // Photo background circle
    ctx.fillStyle = '#00844E';
    ctx.beginPath();
    ctx.arc(photoX, photoY, photoRadius + 5, 0, Math.PI * 2);
    ctx.fill();
    
    // White border
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(photoX, photoY, photoRadius + 2, 0, Math.PI * 2);
    ctx.fill();
    
    if (img) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(photoX, photoY, photoRadius, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(img, photoX - photoRadius, photoY - photoRadius, photoRadius * 2, photoRadius * 2);
        ctx.restore();
    } else {
        ctx.fillStyle = '#dddddd';
        ctx.beginPath();
        ctx.arc(photoX, photoY, photoRadius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.fillStyle = '#072B1A';
        ctx.font = '16px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Photo', photoX, photoY + 5);
    }
    
    // Employee name
    ctx.fillStyle = '#072B1A';
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    let name = frm.doc.employee_name || 'Employee Name';
    ctx.fillText(name.toUpperCase(), 210, 370);
    
    // Designation
    ctx.font = '20px Arial';
    ctx.fillStyle = '#00844E';
    ctx.fillText(frm.doc.designation || 'Position', 210, 400);
    
    // Divider line
    ctx.strokeStyle = '#dddddd';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(60, 430);
    ctx.lineTo(360, 430);
    ctx.stroke();
    
    // ID Number only
    drawInfoCard(ctx, 60, 460, 'ID NUMBER', frm.doc.id_number_cf, '#072B1A');
    
    // Footer section
    ctx.fillStyle = '#072B1A';
    roundedRect(ctx, 30, 560, 360, 70, [0, 0, 20, 20]);
    ctx.fill();
    
    // Footer text
    ctx.fillStyle = '#60d297';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('This card is property of the company', 210, 590);
    ctx.fillText('Please return if found', 210, 610);
}

function drawInfoCard(ctx, x, y, label, value, color) {
    // Label
    ctx.fillStyle = '#000000';
    ctx.font = '12px Arial';
    ctx.textAlign = 'left';
    ctx.fillText(label, x, y);
    
    // Value box
    ctx.fillStyle = '#dddddd';
    roundedRect(ctx, x, y + 10, 300, 50, 8);
    ctx.fill();
    
    // Value text
    ctx.fillStyle = '#072B1A';
    ctx.font = 'bold 24px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(value || 'N/A', 210, y + 40);
}

function drawQRPattern(ctx, x, y, size) {
    // Simple QR code pattern
    ctx.fillStyle = '#000000';
    let cellSize = size / 7;
    for(let i = 0; i < 7; i++) {
        for(let j = 0; j < 7; j++) {
            if(Math.random() > 0.5 || (i < 2 && j < 2) || (i > 4 && j < 2) || (i < 2 && j > 4)) {
                ctx.fillRect(x + i * cellSize, y + j * cellSize, cellSize - 1, cellSize - 1);
            }
        }
    }
}

function roundedRect(ctx, x, y, width, height, radius) {
    if (typeof radius === 'number') {
        radius = [radius, radius, radius, radius];
    }
    ctx.beginPath();
    ctx.moveTo(x + radius[0], y);
    ctx.lineTo(x + width - radius[1], y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius[1]);
    ctx.lineTo(x + width, y + height - radius[2]);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius[2], y + height);
    ctx.lineTo(x + radius[3], y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius[3]);
    ctx.lineTo(x, y + radius[0]);
    ctx.quadraticCurveTo(x, y, x + radius[0], y);
    ctx.closePath();
}

function saveCanvasAsAttachment(canvas, frm) {
    canvas.toBlob(function(blob) {
        let filename = `employee_id_card_${frm.doc.id_number_cf}_${new Date().getTime()}.png`;
        
        let formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('doctype', frm.doc.doctype);
        formData.append('docname', frm.doc.name);
        formData.append('is_private', 0);

        let xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/method/frappe.handler.upload_file');
        xhr.setRequestHeader('X-Frappe-CSRF-Token', frappe.csrf_token);
        
        xhr.onload = function() {
            if (xhr.status === 200) {
                let response = JSON.parse(xhr.responseText);
                if (response.message) {
                    frappe.msgprint(__('Employee card saved to attachments successfully'));
                    frm.reload_doc();
                }
            } else {
                frappe.msgprint(__('Error occurred while saving the card'));
            }
        };
        
        xhr.onerror = function() {
            frappe.msgprint(__('Error occurred while saving the card'));
        };
        
        xhr.send(formData);
    }, 'image/png');
}
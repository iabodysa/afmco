<div style="font-family:Arial,Helvetica,sans-serif; max-width:420px; margin:0 auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; overflow:hidden;">
  <div style="background:#16a34a; padding:16px; text-align:center;">
    <img src="http://afmco.sa/files/Logo-01.png" alt="AFMCO"
     style="max-width:90px; display:block; margin:0 auto 6px; filter:brightness(0) invert(1) contrast(110%);">
     <div style="color:#ffffff; font-weight:700; font-size:16px;">Employee Transfer Request</div>
    <div style="color:#d1fae5; font-size:12px; margin-top:2px;">{{ doc.trip_title or doc.name }}</div>
  </div>

  {% set day = frappe.utils.getdate(doc.required_arrival_date).strftime('%A') if doc.required_arrival_date else '' %}
  {% set reg = (doc.employees | len) if doc.employees else 0 %}
  {% set unreg = (doc.unregistered_employee | len) if doc.unregistered_employee else 0 %}
  {% set pax = reg + unreg %}
  {% set amt = frappe.utils.fmt_money(doc.amount or 0, currency=(doc.currency or 'SAR')) %}

  <div style="padding:14px;">
    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:10px;">
      <span style="background:#e9f7ee; color:#16a34a; padding:6px 10px; border-radius:999px; font-size:12px; font-weight:600;">{{ doc.trip_type }}</span>
      <span style="background:#f1f5f9; color:#111827; padding:6px 10px; border-radius:999px; font-size:12px;">{{ doc.required_arrival_date or '' }} {{ doc.required_arrival_time or '' }} {{ day }}</span>
      <span style="background:#fef3c7; color:#92400e; padding:6px 10px; border-radius:999px; font-size:12px;">Employees: {{ pax }}</span>
      <span style="background:#ecfdf5; color:#065f46; padding:6px 10px; border-radius:999px; font-size:12px;">Amount: {{ amt }}</span>
    </div>

    <div style="border:1px dashed #d1d5db; border-radius:10px; overflow:hidden;">
      <div style="background:#f9fafb; padding:12px 14px;">
        {% if doc.trip_type == 'Out City' %}
        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:700; color:#111827;">
          <span>From</span><span style="font-size:12px; color:#6b7280;">→</span><span>{{ doc.current_city or '-' }}</span>
        </div>
        <div style="height:8px;"></div>
        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:700; color:#111827;">
          <span>To</span><span style="font-size:12px; color:#6b7280;">→</span><span>{{ doc.destination_city or '-' }}</span>
        </div>
        {% else %}
        <div style="display:flex; justify-content:space-between; align-items:center; font-weight:700; color:#111827;">
          <span>In City</span><span style="font-size:12px; color:#6b7280;">→</span><span>{{ doc.current_city or '-' }}</span>
        </div>
        {% endif %}
      </div>

      <table style="width:100%; border-collapse:collapse;">
        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Pickup</td>
          <td style="padding:10px 14px; text-align:right;">
            {% if doc.pickup_location %}
              <a href="{{ doc.pickup_location }}" style="color:#16a34a; text-decoration:none; font-weight:600;">Open in Maps</a>
            {% else %}<span style="color:#9ca3af;">-</span>{% endif %}
          </td>
        </tr>
        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Dropoff</td>
          <td style="padding:10px 14px; text-align:right;">
            {% if doc.dropoff_location %}
              <a href="{{ doc.dropoff_location }}" style="color:#16a34a; text-decoration:none; font-weight:600;">Open in Maps</a>
            {% else %}<span style="color:#9ca3af;">-</span>{% endif %}
          </td>
        </tr>

        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Transport Type</td>
          <td style="padding:10px 14px; text-align:right; color:#111827; font-weight:600;">{{ doc.transport_type or '-' }}</td>
        </tr>

        {% if doc.transport_type == 'From Company' %}
        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Driver</td>
          <td style="padding:10px 14px; text-align:right; color:#111827; font-weight:600;">{{ doc.driver or '-' }}</td>
        </tr>
        {% endif %}

        {% if doc.transport_type == 'Supplier' or doc.transport_type == 'Ticket Purchase' %}
        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Supplier</td>
          <td style="padding:10px 14px; text-align:right; color:#111827; font-weight:600;">{{ doc.supplier_name or '-' }}</td>
        </tr>
        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Supplier Mobile</td>
          <td style="padding:10px 14px; text-align:right; color:#111827; font-weight:600;">{{ doc.supplier_mobile or '-' }}</td>
        </tr>
        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Supplier IBAN</td>
          <td style="padding:10px 14px; text-align:right; color:#111827; font-weight:600;">{{ doc.supplier_bank_account_number or '-' }}</td>
        </tr>
        {% endif %}

        <tr style="border-top:1px dashed #d1d5db;">
          <td style="padding:10px 14px; color:#6b7280; font-size:12px;">Status</td>
          <td style="padding:10px 14px; text-align:right;">
            <span style="background:#d1fae5; color:#065f46; padding:4px 10px; border-radius:12px; font-size:12px; font-weight:700;">{{ doc.workflow_state or 'Pending' }}</span>
          </td>
        </tr>
      </table>
    </div>

    {% if doc.transfer_reason %}
    <div style="margin-top:12px; padding:10px 12px; background:#f0fdf4; border:1px solid #86efac; border-radius:8px; color:#14532d;">
      <strong style="color:#166534;">Reason:</strong> {{ doc.transfer_reason }}
    </div>
    {% endif %}

    {% if doc.notes %}
    <div style="margin-top:8px; padding:10px 12px; background:#ecfeff; border:1px solid #bae6fd; border-radius:8px; color:#0c4a6e;">
      <strong>Notes:</strong> {{ doc.notes }}
    </div>
    {% endif %}

    <div style="text-align:center; margin-top:14px;">
      <a href="{{ frappe.utils.get_url_to_form(doc.doctype, doc.name) }}" style="display:inline-block; background:#16a34a; color:#ffffff; padding:12px 22px; text-decoration:none; border-radius:8px; font-weight:700;">Open Request</a>
    </div>
  </div>

  <div style="background:#f9fafb; padding:12px; text-align:center; border-top:1px solid #e5e7eb;">
    <img src="http://afmco.sa/files/Logo-01.png" alt="AFMCO" style="max-width:70px; opacity:.9;">
    <p style="margin:6px 0 0; font-size:11px; color:#6b7280;">AFMCO Operations System</p>
  </div>
</div>
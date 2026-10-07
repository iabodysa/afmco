# Copyright (c) 2026, AFMCO and contributors
# For license information, please see license.txt

from base64 import b64encode
from io import BytesIO

from pyqrcode import create


def asset_qr_data_uri(value):
	stream = BytesIO()
	create(value, error="M").svg(stream, quiet_zone=1, xmldecl=False, omithw=True)
	return "data:image/svg+xml;base64," + b64encode(stream.getvalue()).decode()

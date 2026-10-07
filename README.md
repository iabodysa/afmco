# AFMCO

Customization for AFMCO.

## Modules

- Afmco: company DocTypes and reports, the `iqama-control` Desk page, notifications, server scripts, workspaces, and custom fields and property setters on ERPNext, HRMS and Helpdesk DocTypes.

## Required apps

Declared in `afmco/hooks.py` as `required_apps`:

- erpnext
- hrms

## Installation

Fetch each required app into the bench first. `install-app` installs every required app on the site before this one and stops when a required app is missing from the bench.

```bash
cd $PATH_TO_YOUR_BENCH
bench get-app https://github.com/iabodysa/afmco
bench --site $SITE_NAME install-app afmco
```

## Third-party fonts

Shipped in `afmco/public/fonts/`, each under the SIL Open Font License 1.1 in the licence file beside it:

- Saudi Riyal Font © Emran Alhaddad - Used under SIL Open Font License 1.1 (`OFL-SaudiRiyal.txt`)
- Montserrat © The Montserrat Project Authors - Used under SIL Open Font License 1.1 (`OFL-Montserrat.txt`)
- Tajawal © Boutros International - Used under SIL Open Font License 1.1 (`OFL-Tajawal.txt`)

## License

MIT

# Invoice Export

## Context

This repository is the existing back office for our invoicing product: an Express API over PostgreSQL (see `src/`). Accountants have asked to export invoices so they can import them into their accounting software. Build on the existing code: reuse its routing, database access and auth middleware rather than adding new frameworks.

## Requirements

### CSV export

`GET /invoices/export.csv` returns the signed-in account's invoices as CSV, one row per invoice line, with the columns: invoice number, issue date, customer name, line description, quantity, unit price, tax rate, line total, currency. Dates are ISO 8601. Amounts use a dot as the decimal separator and no thousands separator.

### Filters

The export accepts `from` and `to` dates (by issue date) and a `status` (`draft`, `sent`, `paid`, `void`). Without filters it exports the last 12 months. Invalid dates answer 400 with a message naming the bad parameter.

### Large exports

An account can have 200,000 invoice lines a year. The export must stream rows instead of loading them into memory, and must not hold a database connection for more than 60 seconds.

### Access

Only users with the `accountant` or `owner` role may export. Every export is recorded in the existing `audit_log` table.

### Export button

The invoices page in the existing admin UI gets an "Export CSV" button that uses the current filters.

## Out of Scope

PDF export and direct integrations with accounting software.

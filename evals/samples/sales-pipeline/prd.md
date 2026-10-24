# Nightly Sales Data Pipeline

## Background

Finance builds the daily sales report by hand from three exports. It takes two hours each morning and is often wrong. We want a pipeline that loads the data overnight and publishes clean tables the BI tool reads.

## Sources

- **Shop orders**: PostgreSQL read replica of the e-commerce database, tables `orders`, `order_items`, `refunds`.
- **Payments**: Stripe, through its API (charges, refunds, payouts).
- **Marketplace sales**: a CSV file an Amazon seller report drops into `s3://acme-raw/amazon/` each night.

## Stack Requirements

The data team has standardized on these; the plan must use them:

- Apache Airflow 2.10 (managed on AWS MWAA) for orchestration.
- dbt Core 1.8 for transformations, with tests on every model.
- Snowflake as the warehouse; raw data lands in the `RAW` database, models build in `ANALYTICS`.
- Python 3.12 for extract code, packaged as one internal library.

## Requirements

### Extract and load

Each source loads into its own raw schema once a night by 03:00 UTC. Loads are incremental by updated-at timestamp and safe to re-run for any past day.

### Transform

dbt models produce `fct_sales` (one row per order line from any channel, in USD), `fct_refunds`, and `dim_products`. Currency conversion uses the daily ECB rate.

### Data quality

dbt tests check uniqueness and not-null keys, that every Stripe charge matches an order, and that daily totals are within 1% of Stripe payouts. A failing test stops downstream models and alerts the `#data-alerts` Slack channel.

### Backfill

A one-off backfill loads the last two years of history.

## Operations

- Failures retry twice, then alert.
- A runbook explains how to re-run a day.

## Out of Scope

Real-time dashboards and forecasting.

# EnergyOS production monitoring

Inventory in `fleet.json` records three existing, authorized Railway services.
It is not an instruction to provision another fleet. Reuse the listed service and
volume IDs; never delete a volume to redeploy configuration.

The only public endpoint is https://energyos-grafana-production.up.railway.app.
Grafana uses the sole platform technical account `energyosowner`, with anonymous
access and signup disabled. Its password is stored in the service variable
`GF_SECURITY_ADMIN_PASSWORD`; do not copy its value to source, logs or reports.
This is a separate login, without EnergyOS SSO. Collector and Prometheus remain
private. No fourth paid service or new PostgreSQL instance is part of this fleet.

## Deployment checks

Root directory is `/ops/observability`; Dockerfiles are `production/Dockerfile.*`.
Watch patterns include repository and service-relative paths:
`/ops/observability/**`, `ops/observability/**`, `production/**`.
A prior leading-slash-only configuration skipped the alerts update. Check actual
running rule names after deployment; a GitHub merge does not prove they loaded.
The next operations-only change should build these three services, while API and
worker retain their backend watch paths. Confirm automatic triggering from the
Railway deployment receipts rather than inferring it from saved settings.

Deploy only this fleet for observability changes. Confirm health, private scrape,
API/worker samples and anonymous HTTP 401 after completion. Prometheus rules must
include `EnergyOSApiSamplesAbsent` and `EnergyOSWorkerSamplesAbsent`, in addition
to collector, stale/absent sample and event-loop rules. Notification channels are
not yet configured. Rules alone do not deliver an alert to the Owner.

The production restart check preserved a historical Prometheus query and a Grafana
organization setting in SQLite. CI also rehearses volumes, privilege drop,
export failure and privacy canaries. These are not representative financial/OCR
load tests or proof of a measured SLO. Keep the 24–72 hour BETA observation window.

## Resources and rollback

Keep one replica and the memory/CPU limits recorded in the inventory. Retain
Prometheus data for 72 hours / 512 MB. Grafana uses SQLite, console logging and
no plugin preinstallation. Use bounded exporting; loss of telemetry must not block
business requests. Roll back the image/configuration if needed, preserving volumes
and secrets. Do not stop API/worker or change customer permissions for this rollback.

Railway Pro gives volumes a 50 GB logical default and cannot shrink them. Billing
uses actual occupied storage including provider metadata; 1 GB per volume was a
usage budget, not an enforced provider capacity. See the official
[volume reference](https://docs.railway.com/volumes/reference).
The authorized US$50 monthly monitoring budget is not a hard billing cutoff.
Check actual use; builds, egress, taxes and storage metadata can affect charges.
No automatic budget action may shut down the business services.

# Address geocoding pilot

Uses the canonical saved consumer-unit address, city and UF. OCR must first be reviewed and saved through the existing registration flow. No automatic OCR import or bulk backfill is enabled.

Private service-only RPCs revalidate tenant, membership, license, address fingerprint and revision. Suggestions are retained with permanent Mapbox v6 geocoding and require human confirmation through the existing audited location writer. Global view remains read-only.

Backend configuration: MAPBOX_GEOCODING_TOKEN (separate server public token, no URL restriction); ENERGY_MAP_GEOCODING_PERMANENT=true; ENERGY_MAP_GEOCODING_ORGANIZATIONS=org_default. Never use NEXT_PUBLIC for this server variable. Flag defaults off.

Hard caps: 10 requests per organization per Sao Paulo calendar day, 100 across all organizations per calendar month. Admission uses a shared database lock. One dispatch per unit/address fingerprint; failed or expired requests are not automatically retried, to prevent uncertain duplicate billing. Manual verification remains available.

Migration f11 creates only new jobs table/functions, RLS enabled, browser roles denied. Confirmation preserves immutable location history and request idempotency. Rollback: remove organization feature flag; do not erase audit data.

Provider reference: https://docs.mapbox.com/api/search/geocoding/

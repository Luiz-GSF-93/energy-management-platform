# Conditional climate scenario in the forecast engine

This is an additive extension to the isolated forecast module. It does not change authentication, roles, licences, financial engines, CCEE, tables or existing forecast snapshots. Existing request IDs still return their original immutable result. A new request is required to calculate a new version, which remains preliminary until the existing validation and publication transitions are performed by an authorized user.

## Inputs and qualifications

NASA POWER `T2M`, Celsius, UTC, regional reference coordinates with explicit consent, complete daily coverage, retrieval metadata and raw response SHA-256 remain provided by the existing adapter. Coordinates are sent only to NASA; consumption and invoices remain in the backend. The climate calculation performs no network calls.

30–36 contiguous approved consumption months are required. Each billed-day count must match its calendar month, and weather must cover those full months without gaps or duplicates. This count check is a necessary compatibility screen, **not proof of actual reading-date alignment**. The monthly model uses competence as a proxy for billing interval; a responsible reviewer must check the invoice reading periods. A future enhancement must persist exact reading dates before modelling crossing-month billing intervals. Ineligible histories retain their existing forecast and record the rejection reason. The 12-month pilot therefore cannot provide a calibrated climate forecast yet.

## Model and chronological test

Predict daily consumption from intercept, linear time trend, annual sine/cosine seasonality and standardized monthly temperature. Estimate coefficients with reorthogonalized QR; reject a rank-deficient temperature column rather than inventing a coefficient. No new statistical dependencies are required.

Use six expanding chronological origins, each with at least 24 training months, and horizons one to six. At each origin fit only consumption and temperatures from earlier months. For unseen target temperatures use the same-month value twelve months earlier, available before the origin. **Do not use observed target-period temperatures in the test**. Historical provider corrections may nevertheless exist in the retrieved snapshot; this is retrospective validation, not a replay of weather releases as known at each original date.

Compare all candidates on the same targets and kWh MAE. References comprise the existing mean, linear and seasonal candidates, and a matching trend plus seasonal harmonic regression without temperature. The climate candidate must improve MAE by **more than 10%** against the best reference and beat the matching no-temperature regression in at least four of six origins. The 10% threshold is a conservative product policy, not a universal scientific constant. Ties retain the non-climate result. This limited test is not a guarantee of forecasting accuracy.

Project only if the remaining horizon through December is at most six months. Future temperature repeats last year's same-month temperature: it is an explicitly labelled historical scenario, **not a weather forecast or a long-term climatological normal**. It does not represent a measured future temperature. Negative/non-finite predictions are rejected. Documented future expansions are added exactly once, using the existing integer-scaled quantities. Demand and carbon do not change kWh.

## Audit and presentation

Applied climate results use `consumption-forecast/1.1`, `CLIMATE_TREND_SEASONAL_DAILY`, `CLIMATE_SCENARIO_APPLIED`, and store `climate-scenario/1.0`, coefficients, temperature scaling, hash, source months, target temperatures, MAEs, improvement and origin scores in the new snapshot. Rejections retain the old formula/method and store their assessment. Both flow through existing payload hash verification, immutable persistence and human approval.

The chart distinguishes applied climate from collected-only/unavailable temperature. Methodological qualifications carry the error comparison and scenario limitations into the existing published projection and export path. There are no calibrated prediction intervals; no range or precision guarantee is fabricated. Climate fit does not establish causality or emissions savings.

## Verification and production boundary

Synthetic fixtures are confined to tests: identifiable climate signal, insufficient history, malformed metadata, missing temperature, incompatible periods, constant/collinear temperature, no gain, expansions, no target-weather leakage, snapshot idempotence/hash and legacy/chart compatibility. Existing report/financial regressions remain required. Real-series validation with 30–36 approved months and confirmed reading periods is required before declaring climate homologation complete. Previously published forecasts are never recalculated in place.

Sources: [Forecasting with regression](https://otexts.com/fpp3/forecasting-regression.html) and [NASA POWER Daily API](https://power.larc.nasa.gov/docs/services/api/temporal/daily/).

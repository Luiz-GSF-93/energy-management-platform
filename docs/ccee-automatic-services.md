# CCEE automatic read services

Initial scope: Expert Energy (`org_default`). Feature flag `CCEE_AUTOMATIC_READ_ENABLED` defaults off. Apply migration `20261229_ccee_automatic_service_policies.sql` before enabling the consumer.

The existing PLD schedule remains hourly. Private FINAL and DRI policies require a complete, successful source from the current reviewed binding; configure paused, then activate. Each request revalidates role, license, binding and lease. No new browser privileges or credentials are granted. A changed binding revision requires new source review.

A missing ListarMedida unit may use a per-binding, audited operator confirmation. Explicit provider units take priority, including unknown units: they cannot be replaced silently. Source active consumption is retained; missing quantity stays unavailable rather than zero. Prior snapshots remain unchanged. Hour labels follow CCEE ticket 00450944 and explicit -03:00 windows.

The hourly planner checks for new information. FINAL monthly reads run at most once per competence/Brasilia day, never once per hour. Previous-closed-month policies wait for the exact approved official calendar event. DRI follows exact reviewed event/report/frame names; unchanged event catalogs do not trigger repeated result downloads. A functional failure or expired result lease requires review; no blind retries.

The shared daily reservation serializes across workers: 200 SOAP requests/day, PLD 60, private measurement/point reads 100, DRI 40. Existing per-execution limits remain. Each profile and pagination call consumes one reservation. Reservations plus legacy completed request counts are combined without counting the same job twice. Budget stops wait for the next Brasilia day.

The UI shows last attempt, successful update, source and next check. Local status refresh runs every 15 seconds while visible, preserving form values and focus; this performs no SOAP call.

Five-minute collection still requires a verified meter identifier and full homologation. A point identifier is not a meter identifier. DRI financial results must succeed before DRI automation is enabled. These policies do not transmit contracts, payments, measurements or financial publications to the CCEE, and do not approve EnergyOS closings.

Rollback: disable `CCEE_AUTOMATIC_READ_ENABLED` and pause private policies; preserve policy/audit tables. PLD remains controlled by its existing flag and schedule. Do not remove immutable history.

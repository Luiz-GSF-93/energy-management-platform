# Regional distribution and concentration

Adds regional cards and an optional heatmap to existing authorized maps. No backend, migration, permissions, provider or geocoding budget changes.

Cards count units and distinct organization/customer pairs in each state on the current page (up to 200 rows), excluding customers without units and invalid UFs. Repeated units are deduplicated. Tenant views explicitly scope rows; global rows remain exclusively sourced by existing platform admin RPC. A customer with units in two states is counted in both. Clicking a card applies the existing state filter.

Heatmap uses a separate unclustered local GeoJSON source with the same confirmed coordinates as markers, uniform weight per unit. Names and financial data are not sent to Mapbox. It depicts unit concentration, not savings, consumption, risk or business performance. Approximate locations remain labeled in details. No confirmed coordinates means an explicit empty message, no fabricated heat points. Switching layer does not recreate the map. Source data refreshes with rows and tenant map is disposed on organization changes.

Validation: regional deduplication, tenant isolation, same customer IDs in different organizations, invalid UFs, stale/invalid coordinates; mocked map source updates, visibility toggle and organization disposal; existing map and geocoding regressions, TypeScript and production build.

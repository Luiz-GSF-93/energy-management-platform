# Client Portal licenses and client capacity

The organization license remains the parent entitlement. A client Portal license does not create an identity, assign a role, bind a person to a customer, or open Backoffice routes. Portal access still requires an active external Consulta membership, its explicit exclusive customer binding and each endpoint's existing permissions. Only published customer results are exposed.

## Disabled deployment

1. Apply `20261009_client_portal_licenses.sql` before enabling the backend feature. It adds nullable client capacities and empty, RLS-protected Portal tables; it does not update existing plan/license snapshots, grant access, or enable an organization policy.
2. Deploy with `CLIENT_PORTAL_LICENSES_ENABLED` unset or `false`. The new management response is unavailable and does not query the new tables. Writes to these endpoints remain disabled. Existing customer registration and Portal behavior are preserved.
3. Leave `NEXT_PUBLIC_CLIENT_PORTAL_LICENSES_ENABLED` unset or `false` in the frontend. The Portal preserves its current data components without requesting the new entitlement endpoint. The server remains the authority; a frontend flag cannot bypass licensing.

## Reviewed activation, separate from this deployment

1. The platform administrator defines `max_clients` in the catalog. Blank/omitted values preserve the previous definition; undefined is neither zero nor unlimited. Apply the selected catalog version to the existing organization license through its existing governance endpoint. Do not create a second concurrent parent license.
2. Check retained customer count. Each non-deleted customer occupies one slot, including inactive customers. Existing customers are preserved on expiration, cancellation or a capacity shortfall; new registrations/restorations are blocked while the enabled policy has insufficient capacity.
3. Enable the backend feature to prepare conditions, with every organization's policy still disabled. In **Licenses → Portal do cliente e cota de clientes**, record explicit client limits, dates and modules within the parent entitlement. This does not invite or grant a user access. Customer names are resolved only inside the organization; no client-supplied tenant is accepted.
4. The separately authorized account/binding review must confirm external Consulta, an exclusive customer association and the minimal module permissions. Do not broaden legacy shared accounts or release all customers by default.
5. Enable the frontend feature in a new build and verify the isolated pilot. The entitlement endpoint fails closed on an expired/missing grant or invalid binding; the UI does not mount report components after an authorization failure. Only a 404 from an older backend uses compatibility behavior.
6. Review and explicitly activate the organization's policy. The transaction checks its current quota and current external exclusive memberships. No policy is activated by migration or page load.

## Capacity and audit

Client creation/restoration, policy changes, parent snapshots, client concessions and additions serialize through the organization's existing advisory-lock key. Catalog changes retain the platform governance lock. The old user/unit/document quota triggers remain in place; child Portal user/unit limits add constraints to that parent authority.

Client additions require an explicit UUID, optimistic revision, approved commercial reference, validity dates and justification. Repeating a stale request fails rather than creating a second addition. No price, payment, subscription or automatic upgrade is created. Cancellation is audited and does not delete customers.

Portal history is immutable and records actor ID, the registered name and platform affiliation/role as a snapshot, plus justification and before/after conditions. Missing names remain explicitly unidentified rather than being replaced with a role name. This migration does not rewrite historical audit entries in other modules.

## Verification

Backend tests cover default-off behavior, authenticated tenant derivation, exact route allowlisting, independent platform/RBAC checks, strict DTOs, foreign customer rejection and management list overflow. Frontend DOM checks cover disabled/read-only controls, an exact scoped save payload, no automatic writes, failed authorization and module filtering. The existing licensing UI regression suite must also pass.

The migration was exercised in a rollback transaction against the existing schema: default-off and service-only/RLS boundaries, plan snapshot quota, creation/update/stale revision, unknown/foreign customer rejection, capacity exhaustion, one approved addition and immutable audit. Capacity insertion probes used temporary tables and existing rows; no customer/account fixture was persisted. Concurrent request stress testing and an external account end-to-end pilot remain rollout checks; the rollback test alone does not establish those outcomes.

The official RAG library and financial calculations are outside this change. No draft chunk is reviewed or released automatically.

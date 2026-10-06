# Independent energy classification in contract registration

The guided distributor entry and the distributor configuration editor now offer independent choices for ACL/ACR, distributed generation (GD), and battery storage (BESS). This closes the gap between contract registration and the customer/unit registration screens used by the energy map.

Values are real booleans, with missing values kept unknown. Existing true, false and null values are preserved when the editor opens. No legacy unit is classified automatically, and no production customer records are changed by this release.

The existing create/edit permissions, organization scoping, mandatory correction reason, optimistic edit version and idempotent request identifier remain in place. No database migration or privilege change is required.

Validation: the real wizard DOM tests cover ACR+GD+BESS, ACL+GD without BESS, unknown selections, back navigation, saved draft resumption and failed saves. Editor DOM tests cover value preservation and audited retry payloads. Backend draft validation tests accept independent booleans/null and reject string booleans. Existing guided entry tests and production frontend build are also checked.

Run from frontend: `node test/contract-classification-edit.cjs`, `node test/contract-classification-wizard.cjs`, `node test/entry-wizard.cjs` after building backend. Run from backend: `npx jest entry-classification.spec.ts entry-drafts.spec.ts --runInBand`.

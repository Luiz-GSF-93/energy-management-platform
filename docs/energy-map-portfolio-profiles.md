# Interactive portfolio energy profiles

The organization and platform maps now summarize the combinations of market (ACL/ACR/unknown), distributed generation (GD) and storage (BESS) present in the loaded page. Clicking a profile applies all three filters together and resets pagination. Clearing profile filters preserves the other search, organization, state and location filters.

Groups are derived from authorized map rows already loaded in the browser. Each organization/unit pair is counted once; customers are deduplicated by organization/customer within each group. Customers without a unit are omitted. A customer can occur in more than one profile. Unknown and explicit false remain separate classifications. Counts are explicitly page-scoped rather than represented as totals across unloaded pages.

No new API, database migration, provider request or permission is introduced. Private customer information stays within the existing authorized data flow. Existing tenant scoping and global administrator access remain unchanged.

Validation: `node test/portfolio-profiles.cjs` covers organization isolation, duplicate rows and IDs across organizations, empty inventory, customers without units, true/false/unknown classification, combined filter callback, active state and clearing. Existing energy map, territory, density and classification tests plus the frontend production build are regression checks. Live production checks exercise the profile on both scopes without modifying customer data.

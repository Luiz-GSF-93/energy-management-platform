# EVA monthly references

EVA_MANAGEMENT_DEFAULTS_ENABLED derives only explicitly confirmed recurring fee policy before invoice scope selection. Explicit monthly exceptions remain authoritative.

CCEE_VALIDATED_COST_HISTORY_ENABLED adds one bounded read per unit for monthly cost records in the previous six months. Enable in API and EVA worker together after deployment. The existing CCEE_COST_ESTIMATE_ENABLED flag is still required. No migration, document upload, OCR or AI call is introduced. Disable the new flag to return to the prior history sources.

The latest cost version must be validated, with revision, date, author and source. Actual operational costs and credits are weighted over up to three eligible months (3/2/1, renormalized). Earlier estimates, collateral and penalties do not become actual observations. A newer draft cannot silently fall back to an older validated cost version. Current costs and explicit no-cost declarations always take precedence.

The report preserves source cost ID, revision and digest as the evidence snapshot. The proposed result remains an identified estimate for human review; it does not approve, publish, charge or rewrite the historical closing. Never replace a current monthly record merely to match a historical average.

All reads bind organization, customer, unit and prior month. Responses outside scope or above the bounded history limit fail without using partial data. Regression tests cover isolation, future dates, draft/ambiguous versions, actual corrections, weighted rounding and rejection of estimated observations.

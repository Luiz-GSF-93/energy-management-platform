# Portal composition correction

The composition selector now has its own year and all twelve months, independent of the surrounding dashboard filter. A client may select a single month, several nonconsecutive months, or all published months. The annual publication manifest verifies the publication, unit, customer and period of every displayed row.

Migration `20261211_portal_published_cost_composition.sql` adds an allowlisted projection of monthly costs already included in the same immutable published closing. It excludes supplier purchases, costs already present in the distributor document, consumed contract cost sources, pending fields and ACR-only items. Existing callers and private grants remain compatible; no tables or financial records change.

The backend reconciles distributor + supplier + published monthly costs + fees to the exact immutable total before displaying a donut. Published monthly CCEE and a separately imported CCEE audit snapshot are never added twice. Tax segregation is shown when demonstrated. Mixed historical tax detail is consolidated at the common gross invoice level with an explicit notice. Missing sources never become zero or balancing expenses.

The optional `months` query is limited to twelve distinct valid months inside the authorized period; existing `month` remains compatible. Corrections and their potential totals follow the selected publications. No OCR, external CCEE requests, notifications, approval or financial publication is triggered.

Validation covers monthly CCEE reconciliation, duplicate costs, credits, gross historical composition, mixed tax detail, nonconsecutive selection, narrow parent period, private gateway grants and source exclusions.

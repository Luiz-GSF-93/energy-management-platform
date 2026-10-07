# WhatsApp delivery callbacks

Callback: https://energy-management-platform-production.up.railway.app/api/v1/integrations/whatsapp/webhook

Required Railway secrets: WHATSAPP_APP_SECRET (EnergyOS app secret from Meta basic settings), WHATSAPP_WEBHOOK_VERIFY_TOKEN (administrator-generated random secret shared only with the callback verification form). WHATSAPP_BUSINESS_ACCOUNT_ID=1079860628232165 and existing WHATSAPP_PHONE_NUMBER_ID=1366086503255033.

Configure the callback under the EnergyOS app WhatsApp configuration, verify/save, subscribe to messages, then subscribe the app to this WABA through the Graph subscribed_apps edge. Do not replace the existing send token for this step. Never paste secrets into chat. User handles credential entry and submission.

POST callbacks require HMAC-SHA256 of exact raw bytes using the app secret. Only signed events for the configured WABA and phone are persisted. Incoming message contents, recipients, contacts and provider descriptions are discarded. Errors retain numeric codes only. Missing configuration fails closed. Storage failure returns 503 for provider retry; primary event key deduplicates replays. Event chronology is preserved, not collapsed to a possibly regressed status.

The service-only RLS table is read through a global administrator endpoint. Organization operation and client portal have no access. Dashboard shows the latest 20 events, not an exhaustive message ledger. Local secret presence is not proof of subscription or delivery. Old messages might not be replayed after subscription; a new test requires explicit recipient authorization. No test is sent by setup. Current platform notification adapter's SENT means API acceptance, not confirmed delivery.

Validation: signature tampering, unknown sender/account, metadata minimization, missing configuration, malformed status, duplicate event behavior and persistence retry. Schema checks deny direct anon/authenticated reads. Provider setup remains pending until secrets are provided and Meta verification/subscription succeeds.

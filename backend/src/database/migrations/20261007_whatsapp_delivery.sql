BEGIN;
CREATE TABLE public.platform_whatsapp_status_events(
 event_key text PRIMARY KEY CHECK(length(event_key)<=600),
 message_id text NOT NULL CHECK(length(message_id)<=510),
 status text NOT NULL CHECK(status IN ('sent','delivered','read','failed')),
 event_at timestamptz NOT NULL,error_codes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(error_codes)='array'),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.platform_whatsapp_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_whatsapp_status_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.platform_whatsapp_status_events TO service_role;
COMMIT;

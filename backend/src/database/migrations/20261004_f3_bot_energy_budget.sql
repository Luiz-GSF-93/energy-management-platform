BEGIN;
-- One shared monthly ceiling: conversation + corpus/query embeddings, all workers/orgs.
CREATE TABLE public.bot_energy_ai_months (
 month date PRIMARY KEY CHECK (extract(day FROM month)=1),
 ceiling_micro_usd bigint NOT NULL DEFAULT 50000000 CHECK (ceiling_micro_usd BETWEEN 1 AND 50000000),
 committed_micro_usd bigint NOT NULL DEFAULT 0 CHECK (committed_micro_usd>=0)
);
CREATE TABLE public.bot_energy_ai_usage (
 id uuid PRIMARY KEY, organization_id text NOT NULL CHECK(length(btrim(organization_id))>0), actor_id text NOT NULL CHECK(length(btrim(actor_id))>0),
 month date NOT NULL REFERENCES public.bot_energy_ai_months(month),
 kind text NOT NULL CHECK (kind IN ('conversation','embeddings')),
 reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd>0),
 actual_micro_usd bigint CHECK (actual_micro_usd>=0), input_tokens bigint, output_tokens bigint,
 state text NOT NULL DEFAULT 'RESERVED' CHECK (state IN ('RESERVED','SETTLED','OVERRUN')),
 created_at timestamptz NOT NULL DEFAULT now(), settled_at timestamptz
);
CREATE FUNCTION public.reserve_bot_energy_ai_usage(p_id uuid,p_organization text,p_actor text,p_kind text,p_reserved_micro_usd bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE m date:=date_trunc('month',clock_timestamp() AT TIME ZONE 'UTC')::date; b public.bot_energy_ai_months;
BEGIN
 IF p_id IS NULL OR p_organization IS NULL OR p_actor IS NULL OR p_kind NOT IN ('conversation','embeddings') OR p_kind IS NULL OR p_reserved_micro_usd IS NULL OR p_reserved_micro_usd<=0 THEN RETURN false; END IF;
 INSERT INTO public.bot_energy_ai_months(month) VALUES(m) ON CONFLICT DO NOTHING;
 SELECT * INTO b FROM public.bot_energy_ai_months WHERE month=m FOR UPDATE;
 -- Reusing a request ID never authorizes a second provider call.
 IF EXISTS(SELECT 1 FROM public.bot_energy_ai_usage WHERE id=p_id) OR b.committed_micro_usd+p_reserved_micro_usd>b.ceiling_micro_usd THEN RETURN false; END IF;
 INSERT INTO public.bot_energy_ai_usage(id,organization_id,actor_id,month,kind,reserved_micro_usd) VALUES(p_id,p_organization,p_actor,m,p_kind,p_reserved_micro_usd);
 UPDATE public.bot_energy_ai_months SET committed_micro_usd=committed_micro_usd+p_reserved_micro_usd WHERE month=m;
 RETURN true;
END $$;
CREATE FUNCTION public.settle_bot_energy_ai_usage(p_id uuid,p_organization text,p_actual_micro_usd bigint,p_input_tokens bigint,p_output_tokens bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.bot_energy_ai_usage;
BEGIN
 IF p_actual_micro_usd IS NULL OR p_actual_micro_usd<0 OR p_input_tokens IS NULL OR p_output_tokens IS NULL OR p_input_tokens<0 OR p_output_tokens<0 THEN RETURN false; END IF;
 SELECT * INTO r FROM public.bot_energy_ai_usage WHERE id=p_id AND organization_id=p_organization;
 IF NOT FOUND THEN RETURN false; END IF;
 -- Same lock order as reservation avoids worker deadlocks.
 PERFORM 1 FROM public.bot_energy_ai_months WHERE month=r.month FOR UPDATE;
 SELECT * INTO r FROM public.bot_energy_ai_usage WHERE id=p_id AND organization_id=p_organization FOR UPDATE;
 IF r.state<>'RESERVED' THEN RETURN r.actual_micro_usd=p_actual_micro_usd AND r.input_tokens=p_input_tokens AND r.output_tokens=p_output_tokens; END IF;
 UPDATE public.bot_energy_ai_months SET committed_micro_usd=committed_micro_usd-r.reserved_micro_usd+p_actual_micro_usd WHERE month=r.month;
 UPDATE public.bot_energy_ai_usage SET actual_micro_usd=p_actual_micro_usd,input_tokens=p_input_tokens,output_tokens=p_output_tokens,state=CASE WHEN p_actual_micro_usd>r.reserved_micro_usd THEN 'OVERRUN' ELSE 'SETTLED' END,settled_at=now() WHERE id=p_id;
 -- Timeout/malformed response never releases a reservation: manual provider reconciliation.
 RETURN p_actual_micro_usd<=r.reserved_micro_usd;
END $$;
ALTER TABLE public.bot_energy_ai_months ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_energy_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bot_energy_ai_months,public.bot_energy_ai_usage FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.bot_energy_ai_months,public.bot_energy_ai_usage TO service_role;
REVOKE ALL ON FUNCTION public.reserve_bot_energy_ai_usage(uuid,text,text,text,bigint),public.settle_bot_energy_ai_usage(uuid,text,bigint,bigint,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_bot_energy_ai_usage(uuid,text,text,text,bigint),public.settle_bot_energy_ai_usage(uuid,text,bigint,bigint,bigint) TO service_role;
COMMIT;

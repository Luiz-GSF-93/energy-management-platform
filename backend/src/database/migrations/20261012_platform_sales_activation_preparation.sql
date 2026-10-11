BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
-- Preparation only: no executor, credentials, user invitations or license writes.
CREATE TABLE IF NOT EXISTS public.platform_sales_activation_requests (
 id uuid PRIMARY KEY,environment text NOT NULL DEFAULT 'SANDBOX' CHECK(environment='SANDBOX'),
 organization_id text NOT NULL REFERENCES public.organizations(id),
 proposal_id uuid NOT NULL REFERENCES public.platform_sales_proposals(id),
 document_id uuid NOT NULL REFERENCES public.platform_sales_signed_documents(id),
 binding_id uuid NOT NULL REFERENCES public.platform_sales_asaas_bindings(id),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(environment,organization_id,proposal_id),UNIQUE(environment,proposal_id),UNIQUE(environment,document_id),UNIQUE(environment,binding_id)
);
CREATE TABLE IF NOT EXISTS public.platform_sales_activation_checks (
 id uuid PRIMARY KEY,activation_id uuid NOT NULL REFERENCES public.platform_sales_activation_requests(id),
 version integer NOT NULL CHECK(version>0),snapshot jsonb NOT NULL,source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 blockers jsonb NOT NULL CHECK(jsonb_typeof(blockers)='array'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(activation_id,version),CHECK(source_hash=encode(pg_catalog.sha256(convert_to(snapshot::text,'UTF8')),'hex'))
);
CREATE TABLE IF NOT EXISTS public.platform_sales_activation_events (
 request_id uuid PRIMARY KEY,activation_id uuid NOT NULL REFERENCES public.platform_sales_activation_requests(id),
 version integer NOT NULL CHECK(version>0),state text NOT NULL CHECK(state IN ('PREPARED','CHECKED_INTERNAL','WITHDRAWN')),
 check_id uuid NOT NULL REFERENCES public.platform_sales_activation_checks(id),
 actor_id uuid NOT NULL,actor_name text,justification text NOT NULL,checks jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),UNIQUE(activation_id,version)
);
CREATE INDEX IF NOT EXISTS sales_activation_recent ON public.platform_sales_activation_requests(created_at DESC,id DESC);
DO $$DECLARE t text;BEGIN
 FOREACH t IN ARRAY ARRAY['platform_sales_activation_requests','platform_sales_activation_checks','platform_sales_activation_events'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated,service_role',t);
  EXECUTE format('DROP TRIGGER IF EXISTS commercial_immutable ON public.%I',t);
  EXECUTE format('CREATE TRIGGER commercial_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.platform_sales_commercial_immutable()',t);
 END LOOP;
END$$;

-- Private helper, never directly granted to the API role. No remote calls.
CREATE OR REPLACE FUNCTION public.platform_sales_activation_source(p_org text,p_proposal uuid,p_document uuid,p_binding uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE org jsonb;prop public.platform_sales_proposals;doc public.platform_sales_signed_documents;
 draft public.platform_sales_contract_drafts;b public.platform_sales_asaas_bindings;
 a public.platform_sales_evidence_attempts;r public.platform_sales_evidence_revisions;
 pe public.platform_sales_proposal_events;de public.platform_sales_signed_document_events;
 ce public.platform_sales_contract_events;te public.platform_sales_offer_term_events;
 terms public.platform_sales_offer_terms;financial public.platform_sales_asaas_checks;
 reasons jsonb:='[]';data jsonb;pay jsonb;tax text;customer_tax text;scope jsonb;last_event timestamptz;
BEGIN
 SELECT jsonb_build_object('id',o.id,'name',to_jsonb(o)->>'name','registration',to_jsonb(o)->'registration') INTO org FROM public.organizations o WHERE o.id=p_org AND to_jsonb(o)->>'deleted_at' IS NULL;
 SELECT * INTO prop FROM public.platform_sales_proposals WHERE id=p_proposal;
 SELECT * INTO doc FROM public.platform_sales_signed_documents WHERE id=p_document;
 SELECT * INTO b FROM public.platform_sales_asaas_bindings WHERE id=p_binding;
 IF prop.id IS NULL OR doc.id IS NULL OR b.id IS NULL THEN RAISE EXCEPTION 'Source missing' USING ERRCODE='P3610';END IF;
 IF org IS NULL THEN reasons:=reasons||jsonb_build_array('ORGANIZATION_UNAVAILABLE');END IF;
 SELECT * INTO draft FROM public.platform_sales_contract_drafts WHERE id=doc.draft_id;
 IF draft.proposal_id IS DISTINCT FROM prop.id OR b.proposal_id IS DISTINCT FROM prop.id OR b.environment IS DISTINCT FROM 'SANDBOX' THEN RAISE EXCEPTION 'Sources do not share proposal' USING ERRCODE='P3611';END IF;
 SELECT * INTO pe FROM public.platform_sales_proposal_events WHERE proposal_id=prop.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO de FROM public.platform_sales_signed_document_events WHERE document_id=doc.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO ce FROM public.platform_sales_contract_events WHERE draft_id=draft.id ORDER BY version DESC LIMIT 1;
 SELECT * INTO terms FROM public.platform_sales_offer_terms WHERE proposal_id=prop.id ORDER BY revision DESC LIMIT 1;
 SELECT * INTO te FROM public.platform_sales_offer_term_events WHERE proposal_id=prop.id AND revision=draft.terms_revision ORDER BY version DESC LIMIT 1;
 IF pe.status IS DISTINCT FROM 'APPROVED_INTERNAL' THEN reasons:=reasons||jsonb_build_array('PROPOSAL_NOT_APPROVED');END IF;
 IF de.status IS DISTINCT FROM 'ACCEPTED' OR ce.status IS DISTINCT FROM 'APPROVED_INTERNAL' OR doc.draft_sha256 IS DISTINCT FROM draft.sha256 THEN reasons:=reasons||jsonb_build_array('DOCUMENT_NOT_ACCEPTED');END IF;
 IF draft.snapshot#>'{proposal,snapshot}' IS DISTINCT FROM prop.snapshot THEN reasons:=reasons||jsonb_build_array('CONTRACT_SCOPE_MISMATCH');END IF;
 IF terms.revision IS DISTINCT FROM draft.terms_revision OR te.status IS DISTINCT FROM 'APPROVED_INTERNAL' THEN reasons:=reasons||jsonb_build_array('TERMS_CHANGED');END IF;
 IF terms.definition->>'validUntil' IS NULL OR (terms.definition->>'validUntil')::date<current_date OR prop.snapshot#>>'{policy,starts}' IS NULL OR prop.snapshot#>>'{policy,ends}' IS NULL OR current_date NOT BETWEEN (prop.snapshot#>>'{policy,starts}')::date AND (prop.snapshot#>>'{policy,ends}')::date THEN reasons:=reasons||jsonb_build_array('COMMERCIAL_VALIDITY');END IF;
 -- No guessing from company name/email. Missing registration blocks recipient verification.
 tax:=upper(regexp_replace(coalesce(org#>>'{registration,taxId}',''),'[^0-9A-Za-z]','','g'));
 customer_tax:=upper(regexp_replace(coalesce(draft.snapshot#>>'{parties,customer,document}',''),'[^0-9A-Za-z]','','g'));
 IF length(tax)<>14 OR tax IS DISTINCT FROM customer_tax THEN reasons:=reasons||jsonb_build_array('RECIPIENT_DOCUMENT_UNCONFIRMED');END IF;
 IF EXISTS(SELECT 1 FROM public.licenses l WHERE to_jsonb(l)->>'organization_id'=p_org) THEN reasons:=reasons||jsonb_build_array('EXISTING_LICENSE_REVIEW');END IF;
 SELECT * INTO a FROM public.platform_sales_evidence_attempts WHERE kind='ONCE' AND source_id=b.id ORDER BY created_at DESC,id DESC LIMIT 1;
 SELECT * INTO r FROM public.platform_sales_evidence_revisions WHERE attempt_id=a.id;
 SELECT c.* INTO financial FROM public.platform_sales_asaas_checks c JOIN public.platform_sales_asaas_inbox i ON i.id=c.event_id WHERE i.payment_id=b.payment_id ORDER BY c.created_at DESC,c.id DESC LIMIT 1;
 SELECT max(received_at) INTO last_event FROM public.platform_sales_asaas_inbox WHERE payment_id=b.payment_id;
 pay:=r.evidence->'payment';
 IF r.status IS DISTINCT FROM 'COMPLETE' OR r.evidence->'refundsComplete' IS DISTINCT FROM 'true'::jsonb OR r.evidence->'invoicesComplete' IS DISTINCT FROM 'true'::jsonb OR financial.status IS DISTINCT FROM 'VERIFIED' OR financial.summary->>'status' IS DISTINCT FROM 'RECEIVED' OR pay->>'status' IS DISTINCT FROM 'RECEIVED' THEN reasons:=reasons||jsonb_build_array('RECEIPT_NOT_CONFIRMED');END IF;
 IF financial.summary->>'id' IS DISTINCT FROM b.payment_id OR pay->>'id' IS DISTINCT FROM b.payment_id OR pay->>'reference' IS DISTINCT FROM b.id::text OR pay->>'customer' IS DISTINCT FROM b.customer_id OR financial.summary->>'customer' IS DISTINCT FROM b.customer_id OR financial.summary->>'reference' IS DISTINCT FROM b.id::text OR pay->'grossCents' IS DISTINCT FROM to_jsonb(b.gross_cents) OR financial.summary->'grossCents' IS DISTINCT FROM to_jsonb(b.gross_cents) OR b.gross_cents IS DISTINCT FROM (prop.snapshot->>'initialTotalCents')::bigint OR pay->>'subscription' IS NOT NULL THEN reasons:=reasons||jsonb_build_array('PAYMENT_SOURCE_MISMATCH');END IF;
 IF a.source->>'paymentId' IS DISTINCT FROM b.payment_id OR a.source->>'reference' IS DISTINCT FROM b.id::text OR a.source->>'customer' IS DISTINCT FROM b.customer_id OR a.source->'grossCents' IS DISTINCT FROM to_jsonb(b.gross_cents) OR a.source->'verified' IS DISTINCT FROM 'true'::jsonb OR a.created_at<financial.created_at OR last_event>financial.created_at THEN reasons:=reasons||jsonb_build_array('FINANCIAL_SOURCE_CHANGED');END IF;
 IF EXISTS(SELECT 1 FROM public.platform_sales_asaas_checks c JOIN public.platform_sales_asaas_inbox i ON i.id=c.event_id WHERE i.payment_id=b.payment_id AND c.created_at=financial.created_at AND c.id<>financial.id) THEN reasons:=reasons||jsonb_build_array('FINANCIAL_SOURCE_CHANGED');END IF;
 IF EXISTS(SELECT 1 FROM public.platform_sales_cycle_bindings cb WHERE cb.payment_id=b.payment_id) THEN reasons:=reasons||jsonb_build_array('FIRST_CYCLE_REQUIRED');END IF;
 IF jsonb_typeof(r.evidence->'refunds') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r.evidence->'refunds')='array' THEN r.evidence->'refunds' ELSE '[]' END) x WHERE x->>'status' IN ('DONE','PENDING')) THEN reasons:=reasons||jsonb_build_array('REFUND_EVIDENCE_BLOCKED');END IF;
 scope:=jsonb_build_object('planId',prop.snapshot->'planId','planVersion',prop.snapshot->'planVersion','policyVersion',prop.snapshot->'policyVersion','requestedUnits',prop.snapshot->'units','requestedUsers',prop.snapshot->'users','units',CASE WHEN prop.snapshot#>>'{policy,basis}'='PACKAGE' THEN prop.snapshot#>'{policy,maxUnits}' ELSE prop.snapshot->'units' END,'users',CASE WHEN prop.snapshot#>>'{policy,basis}'='PACKAGE' THEN prop.snapshot#>'{policy,maxUsers}' ELSE prop.snapshot->'users' END,'documentsLimit',prop.snapshot->'documentsLimit','modules',prop.snapshot->'modules','currency',prop.snapshot->'currency','initialTotalCents',prop.snapshot->'initialTotalCents');
 IF scope->>'currency' IS DISTINCT FROM 'BRL' OR scope->>'planId' IS NULL OR scope->>'planVersion' IS NULL OR scope->>'units' IS NULL OR scope->>'users' IS NULL OR NOT prop.snapshot ? 'documentsLimit' OR jsonb_typeof(scope->'modules') IS DISTINCT FROM 'object' THEN reasons:=reasons||jsonb_build_array('SCOPE_INCOMPLETE');END IF;
 data:=jsonb_build_object('environment','SANDBOX','organization',jsonb_build_object('id',p_org,'name',org->'name','documentMatched',length(tax)=14 AND tax=customer_tax),'proposalId',prop.id,'proposalVersion',pe.version,'draftId',draft.id,'draftVersion',ce.version,'draftHash',draft.sha256,'termsRevision',draft.terms_revision,'termsVersion',te.version,'documentId',doc.id,'documentHash',doc.sha256,'documentVersion',de.version,'bindingId',b.id,'paymentId',b.payment_id,'financialCheckId',financial.id,'evidenceId',a.id,'scope',scope,'fiscal',CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(r.evidence->'invoices','[]')) x WHERE x->>'status'='AUTHORIZED') THEN 'EVIDENCE_PRESENT' ELSE 'PENDING_OWNER_REVIEW' END,'blockers',reasons,'realActivationEligible',false);
 RETURN jsonb_build_object('snapshot',data,'sourceHash',encode(sha256(convert_to(data::text,'UTF8')),'hex'),'blockers',reasons,'realActivationEligible',false);
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_activation_source(text,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.platform_sales_activation_action(p_actor uuid,p_action text,p_body jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
#variable_conflict use_variable
DECLARE row public.platform_sales_activation_requests;event public.platform_sales_activation_events;last public.platform_sales_activation_events;
 source jsonb;author text;entity uuid;req uuid;note text;page integer;q text;state text;result jsonb;ck uuid;
BEGIN
 IF p_actor IS NULL THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF (SELECT count(*) FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id WHERE u.user_id::text=p_actor::text AND r.scope='global')<>1 OR NOT EXISTS(SELECT 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text AND r.scope='global' AND r.name='admin_platform' AND r.permissions ? '82e7fc71-479a-4dd6-8b22-4fba6eaa6841' AND t.active AND t.profile='OWNER') THEN RAISE EXCEPTION 'Owner required' USING ERRCODE='42501';END IF;
 IF p_action NOT IN ('list','read') THEN
  PERFORM 1 FROM public.user_roles u JOIN public.roles r ON r.id=u.role_id JOIN public.platform_team_members t ON t.user_id::text=u.user_id::text WHERE u.user_id::text=p_actor::text FOR SHARE OF u,r,t;
  PERFORM public.platform_team_owner(p_actor);
 END IF;
 IF p_body IS NULL OR jsonb_typeof(p_body)<>'object' OR octet_length(p_body::text)>16000 THEN RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';END IF;
 author:=public.platform_sales_finance_name(p_actor);
 IF p_action='list' THEN
  IF p_body-ARRAY['page','search','status']<>'{}' OR NOT p_body ?& ARRAY['page','search','status'] THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  page:=(p_body->>'page')::integer;q:=p_body->>'search';state:=p_body->>'status';
  IF page IS NULL OR page NOT BETWEEN 0 AND 1000 OR q IS NULL OR length(q)>100 OR state IS NULL OR state NOT IN ('','PREPARED','CHECKED_INTERNAL','WITHDRAWN') THEN RAISE EXCEPTION 'Invalid filters' USING ERRCODE='22023';END IF;
  WITH filtered AS(SELECT a.id,a.organization_id,a.proposal_id,a.environment,a.created_at,e.state,e.version,c.snapshot#>>'{organization,name}' company FROM public.platform_sales_activation_requests a CROSS JOIN LATERAL(SELECT * FROM public.platform_sales_activation_events WHERE activation_id=a.id ORDER BY version DESC LIMIT 1)e JOIN public.platform_sales_activation_checks c ON c.id=e.check_id WHERE (state='' OR e.state=state) AND (q='' OR strpos(lower(coalesce(c.snapshot#>>'{organization,name}','')),lower(q))>0 OR strpos(a.proposal_id::text,q)>0 OR strpos(a.organization_id,q)>0))
  SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'rows',(SELECT coalesce(jsonb_agg(x),'[]') FROM(SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET page*25)x),'environment','SANDBOX') INTO result;RETURN result;
 END IF;
 entity:=(p_body->>'id')::uuid;IF entity IS NULL THEN RAISE EXCEPTION 'ID required' USING ERRCODE='22023';END IF;
 IF p_action='read' THEN
  IF p_body-ARRAY['id']<>'{}' THEN RAISE EXCEPTION 'Invalid read' USING ERRCODE='22023';END IF;
  SELECT * INTO row FROM public.platform_sales_activation_requests WHERE id=entity;IF row.id IS NULL THEN RAISE EXCEPTION 'Missing preparation' USING ERRCODE='P3610';END IF;
  source:=public.platform_sales_activation_source(row.organization_id,row.proposal_id,row.document_id,row.binding_id);
  RETURN jsonb_build_object('request',to_jsonb(row),'currentActorName',public.platform_sales_finance_name(row.actor_id),'current',source,'events',(SELECT coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('currentActorName',public.platform_sales_finance_name(e.actor_id)) ORDER BY e.version),'[]') FROM public.platform_sales_activation_events e WHERE activation_id=entity),'checks',(SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.version),'[]') FROM public.platform_sales_activation_checks c WHERE activation_id=entity));
 END IF;
 note:=p_body->>'justification';IF jsonb_typeof(p_body->'justification') IS DISTINCT FROM 'string' OR length(btrim(note)) NOT BETWEEN 20 AND 1000 OR note ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'Justification required' USING ERRCODE='22023';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('sales-activation:'||entity::text,0));
 IF p_action='prepare' THEN
  IF p_body-ARRAY['id','organizationId','proposalId','documentId','bindingId','justification']<>'{}' OR NOT p_body ?& ARRAY['id','organizationId','proposalId','documentId','bindingId','justification'] OR p_body->>'organizationId' IS NULL OR length(p_body->>'organizationId') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid preparation' USING ERRCODE='22023';END IF;
  SELECT * INTO row FROM public.platform_sales_activation_requests WHERE id=entity;
  IF row.id IS NOT NULL THEN IF row.actor_id<>p_actor OR row.organization_id IS DISTINCT FROM p_body->>'organizationId' OR row.proposal_id IS DISTINCT FROM (p_body->>'proposalId')::uuid OR row.document_id IS DISTINCT FROM (p_body->>'documentId')::uuid OR row.binding_id IS DISTINCT FROM (p_body->>'bindingId')::uuid OR row.justification IS DISTINCT FROM note THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3611';END IF;RETURN jsonb_build_object('id',row.id);END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('sales-activation-org:'||(p_body->>'organizationId')||':'||(p_body->>'proposalId'),0));
  IF NOT EXISTS(SELECT 1 FROM public.organizations o WHERE o.id=p_body->>'organizationId' AND to_jsonb(o)->>'deleted_at' IS NULL) THEN RAISE EXCEPTION 'Organization missing' USING ERRCODE='P3610';END IF;
  source:=public.platform_sales_activation_source(p_body->>'organizationId',(p_body->>'proposalId')::uuid,(p_body->>'documentId')::uuid,(p_body->>'bindingId')::uuid);
  INSERT INTO public.platform_sales_activation_requests(id,organization_id,proposal_id,document_id,binding_id,actor_id,actor_name,justification) VALUES(entity,p_body->>'organizationId',(p_body->>'proposalId')::uuid,(p_body->>'documentId')::uuid,(p_body->>'bindingId')::uuid,p_actor,author,note);
  ck:=gen_random_uuid();INSERT INTO public.platform_sales_activation_checks(id,activation_id,version,snapshot,source_hash,blockers) VALUES(ck,entity,1,source->'snapshot',source->>'sourceHash',source->'blockers');
  INSERT INTO public.platform_sales_activation_events(request_id,activation_id,version,state,check_id,actor_id,actor_name,justification) VALUES(entity,entity,1,'PREPARED',ck,p_actor,author,note);
  RETURN jsonb_build_object('id',entity);
 END IF;
 IF p_action='review' THEN
  IF p_body-ARRAY['id','requestId','expectedVersion','sourceHash','status','checks','justification']<>'{}' OR NOT p_body ?& ARRAY['id','requestId','expectedVersion','sourceHash','status','checks','justification'] OR p_body->>'status' NOT IN ('CHECKED_INTERNAL','WITHDRAWN') OR p_body->>'status' IS NULL OR jsonb_typeof(p_body->'checks') IS DISTINCT FROM 'object' OR (p_body->'checks')-ARRAY['recipient','contract','payment','scope','fiscal']<>'{}' OR NOT ((p_body->'checks') ?& ARRAY['recipient','contract','payment','scope','fiscal']) OR EXISTS(SELECT 1 FROM jsonb_each(p_body->'checks') x WHERE jsonb_typeof(x.value)<>'boolean') THEN RAISE EXCEPTION 'Invalid review' USING ERRCODE='22023';END IF;
  req:=(p_body->>'requestId')::uuid;IF req IS NULL OR p_body->>'expectedVersion' IS NULL OR (p_body->>'expectedVersion')::integer<1 OR p_body->>'sourceHash' IS NULL OR p_body->>'sourceHash' !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Review identifiers required' USING ERRCODE='22023';END IF;
  SELECT * INTO event FROM public.platform_sales_activation_events WHERE request_id=req;
  IF event.request_id IS NOT NULL THEN IF event.activation_id<>entity OR event.actor_id<>p_actor OR event.version<>(p_body->>'expectedVersion')::integer+1 OR event.state<>p_body->>'status' OR event.checks IS DISTINCT FROM p_body->'checks' OR event.justification<>note OR (SELECT source_hash FROM public.platform_sales_activation_checks WHERE id=event.check_id) IS DISTINCT FROM p_body->>'sourceHash' THEN RAISE EXCEPTION 'Changed replay' USING ERRCODE='P3611';END IF;RETURN to_jsonb(event);END IF;
  SELECT * INTO row FROM public.platform_sales_activation_requests WHERE id=entity;IF row.id IS NULL THEN RAISE EXCEPTION 'Missing preparation' USING ERRCODE='P3610';END IF;
  SELECT * INTO last FROM public.platform_sales_activation_events WHERE activation_id=entity ORDER BY version DESC LIMIT 1;
  IF last.version IS DISTINCT FROM (p_body->>'expectedVersion')::integer OR last.state='WITHDRAWN' THEN RAISE EXCEPTION 'Stale or withdrawn' USING ERRCODE='P3611';END IF;
  source:=public.platform_sales_activation_source(row.organization_id,row.proposal_id,row.document_id,row.binding_id);
  IF p_body->>'sourceHash' IS DISTINCT FROM source->>'sourceHash' THEN RAISE EXCEPTION 'Sources changed; reload' USING ERRCODE='P3611';END IF;
  IF p_body->>'status'='CHECKED_INTERNAL' AND (source->'blockers'<>'[]' OR EXISTS(SELECT 1 FROM jsonb_each(p_body->'checks') x WHERE x.value<>'true'::jsonb)) THEN RAISE EXCEPTION 'Evidence blocked' USING ERRCODE='22023';END IF;
  ck:=gen_random_uuid();INSERT INTO public.platform_sales_activation_checks(id,activation_id,version,snapshot,source_hash,blockers) VALUES(ck,entity,last.version+1,source->'snapshot',source->>'sourceHash',source->'blockers');
  INSERT INTO public.platform_sales_activation_events(request_id,activation_id,version,state,check_id,actor_id,actor_name,justification,checks) VALUES(req,entity,last.version+1,p_body->>'status',ck,p_actor,author,note,p_body->'checks') RETURNING * INTO event;
  RETURN to_jsonb(event);
 END IF;
 RAISE EXCEPTION 'Unknown action' USING ERRCODE='22023';
END$$;
REVOKE ALL ON FUNCTION public.platform_sales_activation_action(uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.platform_sales_activation_action(uuid,text,jsonb) TO service_role;
COMMIT;

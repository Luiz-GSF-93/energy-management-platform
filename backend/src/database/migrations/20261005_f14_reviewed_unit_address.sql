BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
CREATE TABLE public.ocr_unit_address_corrections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id text NOT NULL REFERENCES public.organizations(id),
 document_id text NOT NULL REFERENCES public.documents(id),consumer_unit_id text NOT NULL REFERENCES public.consumer_units(id),
 registration_edit_id uuid NOT NULL REFERENCES public.registration_edits(id),job_id uuid NOT NULL REFERENCES public.document_ocr_jobs(id),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),source_snapshot jsonb NOT NULL CHECK(octet_length(source_snapshot::text)<50000),
 input jsonb NOT NULL,result jsonb NOT NULL,request_id uuid NOT NULL,created_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organization_id,request_id)
);
ALTER TABLE public.ocr_unit_address_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ocr_unit_address_corrections FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON public.ocr_unit_address_corrections TO service_role;
CREATE TRIGGER preserve_ocr_address_correction BEFORE UPDATE OR DELETE ON public.ocr_unit_address_corrections
 FOR EACH ROW EXECUTE FUNCTION public.preserve_registration_edit();
CREATE FUNCTION public.assert_reviewed_address_actor(p_org text,p_actor text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_energy_map_actor(p_org,p_actor,true);
 IF NOT EXISTS(SELECT 1 FROM public.platform_organization_sessions WHERE organization_id=p_org AND user_id::text=p_actor AND expires_at>now() AND revoked_at IS NULL)
 AND NOT EXISTS(SELECT 1 FROM public.organization_members m JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id
  WHERE m.organization_id=p_org AND m.user_id::text=p_actor AND upper(m.status)='ACTIVE'
  AND r.permissions::jsonb ?& ARRAY['8f105b02-4443-49de-b188-847e0284e7ed','92e1b670-ab10-483a-b825-c6e16799496d'])
 THEN RAISE EXCEPTION 'Document review permissions required' USING ERRCODE='42501';END IF;
END $$;
CREATE FUNCTION public.save_reviewed_unit_address(p_org text,p_actor text,p_document text,p_input jsonb,p_snapshot jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE previous public.ocr_unit_address_corrections;u public.consumer_units;d public.documents;j public.document_ocr_jobs;
 saved jsonb;changes jsonb;edit_id uuid;rid uuid;before_unit jsonb;c public.customers;
BEGIN
 PERFORM public.assert_reviewed_address_actor(p_org,p_actor);
 IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_input))<>9
 OR NOT p_input ?& ARRAY['address','city','state','reason','expectedVersion','sourceHash','requestId','checkedPdf','checkedUnit']
 OR p_input->'checkedPdf' IS DISTINCT FROM 'true'::jsonb OR p_input->'checkedUnit' IS DISTINCT FROM 'true'::jsonb
 OR jsonb_typeof(p_input->'sourceHash') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'requestId') IS DISTINCT FROM 'string'
 OR p_input->>'requestId' !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 OR p_input->>'sourceHash' !~ '^[a-f0-9]{64}$' OR jsonb_typeof(p_input->'expectedVersion') IS DISTINCT FROM 'number'
 OR jsonb_typeof(p_input->'address') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'city') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_input->'state') IS DISTINCT FROM 'string' OR jsonb_typeof(p_input->'reason') IS DISTINCT FROM 'string'
 OR length(btrim(p_input->>'address')) NOT BETWEEN 5 AND 180 OR length(btrim(p_input->>'city')) NOT BETWEEN 1 AND 60
 OR length(btrim(p_input->>'reason')) NOT BETWEEN 20 AND 500 OR p_input->>'state' NOT IN ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
 OR p_input->>'expectedVersion' !~ '^[0-9]{1,9}$'
 OR (p_input->>'address') ~ '[[:cntrl:];]' OR (p_input->>'city') ~ '[[:cntrl:];]' OR (p_input->>'reason') ~ '[[:cntrl:];]'
 THEN RAISE EXCEPTION 'Invalid address correction' USING ERRCODE='22023';END IF;
 rid:=(p_input->>'requestId')::uuid;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_org,315));
 SELECT * INTO previous FROM public.ocr_unit_address_corrections WHERE organization_id=p_org AND request_id=rid;
 IF FOUND THEN
  IF previous.created_by<>p_actor OR previous.document_id<>p_document OR previous.input<>p_input THEN RAISE EXCEPTION 'Request reused' USING ERRCODE='40001';END IF;
  RETURN previous.result;
 END IF;
 SELECT * INTO u FROM public.consumer_units WHERE organization_id=p_org AND id=p_snapshot#>>'{unit,id}' FOR UPDATE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.customers WHERE organization_id=p_org AND id=u.customer_id AND deleted_at IS NULL) THEN RAISE EXCEPTION 'Unit unavailable' USING ERRCODE='P3840';END IF;
 before_unit:=jsonb_build_object('id',u.id,'customer_id',u.customer_id,'consumer_unit_number',u.consumer_unit_number,'address',u.address,'city',u.city,'state',u.state,'edit_version',u.edit_version);
 IF p_snapshot->>'format' IS DISTINCT FROM 'ocr-address-correction-v1' OR p_snapshot->'unit' IS DISTINCT FROM before_unit OR u.edit_version<>(p_input->>'expectedVersion')::integer THEN RAISE EXCEPTION 'Registration changed' USING ERRCODE='40001';END IF;
 SELECT * INTO c FROM public.customers WHERE organization_id=p_org AND id=u.customer_id AND deleted_at IS NULL FOR SHARE;
 IF NOT FOUND OR p_snapshot#>'{registration,customer}' IS DISTINCT FROM jsonb_build_object('company_name',c.company_name,'document',c.document)
 OR p_snapshot#>'{registration,unit}' IS DISTINCT FROM jsonb_build_object('consumer_unit_number',u.consumer_unit_number,'address',u.address,'free_market',u.free_market)
 THEN RAISE EXCEPTION 'Identity registration changed' USING ERRCODE='40001';END IF;
 SELECT * INTO d FROM public.documents WHERE organization_id=p_org AND id=p_document FOR SHARE;
 IF NOT FOUND OR d.consumer_unit_id IS DISTINCT FROM u.id OR d.customer_id IS DISTINCT FROM u.customer_id OR d.file_verified IS DISTINCT FROM true OR d.document_type IS DISTINCT FROM 'INVOICE_DISTRIBUTOR'
 OR p_snapshot#>>'{document,id}' IS DISTINCT FROM d.id OR p_snapshot#>>'{document,organization_id}' IS DISTINCT FROM p_org
 OR p_snapshot#>>'{document,file_hash}' IS DISTINCT FROM d.file_hash
 OR p_snapshot#>>'{document,customer_id}' IS DISTINCT FROM d.customer_id OR p_snapshot#>>'{document,consumer_unit_id}' IS DISTINCT FROM d.consumer_unit_id
 OR p_snapshot#>>'{document,document_type}' IS DISTINCT FROM d.document_type OR (p_snapshot#>>'{document,reference_month}')::timestamp IS DISTINCT FROM d.reference_month THEN RAISE EXCEPTION 'Document changed' USING ERRCODE='40001';END IF;
 SELECT * INTO j FROM public.document_ocr_jobs WHERE id=(p_snapshot->>'jobId')::uuid AND organization_id=p_org AND document_id=d.id AND file_hash=d.file_hash AND state='SUCCEEDED' FOR SHARE;
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM public.document_ocr_results WHERE job_id=j.id AND organization_id=p_org AND document_id=d.id AND file_hash=d.file_hash)
 OR EXISTS(SELECT 1 FROM public.documents WHERE organization_id=p_org AND consumer_unit_id=u.id AND reference_month=d.reference_month AND document_type='INVOICE_DISTRIBUTOR' AND id<>d.id)
 THEN RAISE EXCEPTION 'OCR source changed or duplicate' USING ERRCODE='40001';END IF;
 changes:=jsonb_build_object('address',p_input->'address','city',p_input->'city','state',p_input->'state');
 saved:=public.edit_registration(p_org,'consumer_units',u.id,p_actor,'Correção de endereço conferida no PDF: '||(p_input->>'reason'),u.edit_version,rid,changes);
 SELECT id INTO edit_id FROM public.registration_edits WHERE organization_id=p_org AND request_id=rid;
 INSERT INTO public.ocr_unit_address_corrections(organization_id,document_id,consumer_unit_id,registration_edit_id,job_id,source_hash,source_snapshot,input,result,request_id,created_by)
 VALUES(p_org,d.id,u.id,edit_id,j.id,p_input->>'sourceHash',p_snapshot,p_input,saved,rid,p_actor);
 RETURN saved;
END $$;
REVOKE ALL ON FUNCTION public.assert_reviewed_address_actor(text,text),public.save_reviewed_unit_address(text,text,text,jsonb,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.assert_reviewed_address_actor(text,text),public.save_reviewed_unit_address(text,text,text,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

BEGIN;
SET LOCAL lock_timeout='5s';
CREATE FUNCTION public.valid_customer_report_contacts(items jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE c jsonb;ids text[]='{}';channel jsonb;k text;
BEGIN
 IF items IS NULL OR jsonb_typeof(items)<>'array' THEN RETURN false;END IF;
 IF jsonb_array_length(items)>50 THEN RETURN false;END IF;
 FOR c IN SELECT value FROM jsonb_array_elements(items) LOOP
  IF jsonb_typeof(c)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(c))<>7 OR EXISTS(SELECT 1 FROM jsonb_object_keys(c) x WHERE x NOT IN ('id','name','department','email','phone','active','channels')) THEN RETURN false;END IF;
  IF jsonb_typeof(c->'id') IS DISTINCT FROM 'string' OR (c->>'id')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR lower(c->>'id')=ANY(ids) OR jsonb_typeof(c->'active') IS DISTINCT FROM 'boolean' OR jsonb_typeof(c->'channels') IS DISTINCT FROM 'array' THEN RETURN false;END IF;
  ids:=array_append(ids,lower(c->>'id'));
  FOREACH k IN ARRAY ARRAY['name','department','email','phone'] LOOP
   IF jsonb_typeof(c->k) IS DISTINCT FROM 'string' OR (c->>k)~'[[:cntrl:]]' OR (c->>k)<>btrim(c->>k) THEN RETURN false;END IF;
  END LOOP;
  IF length(c->>'name') NOT BETWEEN 1 AND 150 OR length(c->>'department')>100 OR length(c->>'email')>254 OR length(c->>'phone')>16 OR ((c->>'email')='' AND (c->>'phone')='') THEN RETURN false;END IF;
  IF ((c->>'email')<>'' AND (c->>'email')!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') OR ((c->>'phone')<>'' AND (c->>'phone')!~'^\+[1-9][0-9]{7,14}$') THEN RETURN false;END IF;
  IF jsonb_array_length(c->'channels')>3 OR (SELECT count(DISTINCT value) FROM jsonb_array_elements(c->'channels'))<>jsonb_array_length(c->'channels') THEN RETURN false;END IF;
  FOR channel IN SELECT value FROM jsonb_array_elements(c->'channels') LOOP
   IF jsonb_typeof(channel)<>'string' OR channel#>>'{}' NOT IN ('email','whatsapp','sms') OR (channel#>>'{}'='email' AND c->>'email'='') OR (channel#>>'{}' IN ('whatsapp','sms') AND c->>'phone'='') THEN RETURN false;END IF;
  END LOOP;
 END LOOP;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.valid_customer_report_contacts(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.valid_customer_report_contacts(jsonb) TO service_role;
ALTER TABLE public.customers ADD COLUMN report_contacts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.customers ADD CONSTRAINT valid_customer_report_contacts CHECK(public.valid_customer_report_contacts(report_contacts));
DO $patch$
DECLARE definition text;needle text;
BEGIN
 definition:=pg_get_functiondef('public.edit_registration(text,text,text,text,text,integer,uuid,jsonb)'::regprocedure);
 needle:='''contact_phone'',''economic_group'',''status''] ELSE';
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Customer registration definition changed';END IF;
 definition:=replace(definition,needle,'''contact_phone'',''economic_group'',''status'',''report_contacts''] ELSE');
 needle:=' IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_changes) x WHERE NOT x=ANY(allowed))';
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 THEN RAISE EXCEPTION 'Registration validation definition changed';END IF;
 definition:=replace(definition,needle,E' IF p_kind=''customers'' AND p_changes ? ''report_contacts'' AND NOT public.valid_customer_report_contacts(p_changes->''report_contacts'') THEN RAISE EXCEPTION ''Invalid customer contacts'' USING ERRCODE=''22023'';END IF;\n'||needle);
 EXECUTE definition;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;

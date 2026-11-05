BEGIN;
SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='45s';
-- Generic training media only. No customer documents, role grants or financial writes.
CREATE TABLE public.training_content_versions(
 id text PRIMARY KEY, title text NOT NULL, version text NOT NULL,
 status text NOT NULL DEFAULT 'DRAFT' CHECK(status IN('DRAFT','PUBLISHED','RETIRED')),
 mandatory boolean NOT NULL DEFAULT false, duration_seconds integer NOT NULL CHECK(duration_seconds BETWEEN 30 AND 7200),
 asset_prefix text NOT NULL CHECK(asset_prefix ~ '^ccee/[a-z0-9-]+/$'),
 organization_ids text[] NOT NULL DEFAULT '{}', chapters jsonb NOT NULL DEFAULT '[]',
 media_hash text CHECK(media_hash IS NULL OR media_hash ~ '^[0-9a-f]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz,
 UNIQUE(version),CHECK(jsonb_typeof(chapters)='array'),CHECK(cardinality(organization_ids)<=5000)
);
CREATE TABLE public.organization_training_progress(
 organization_id text NOT NULL REFERENCES public.organizations(id),user_id uuid NOT NULL REFERENCES auth.users(id),
 content_id text NOT NULL REFERENCES public.training_content_versions(id), watched integer[] NOT NULL DEFAULT '{}',
 position_seconds double precision NOT NULL DEFAULT 0,completed_at timestamptz,deferred_at timestamptz,
 player_id uuid,last_tick timestamptz,last_position double precision,playing boolean NOT NULL DEFAULT false,
 revision integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(organization_id,user_id,content_id),CHECK(position_seconds>=0),CHECK(cardinality(watched)<=7200)
);
CREATE INDEX training_own_progress ON public.organization_training_progress(organization_id,user_id,completed_at);
ALTER TABLE public.training_content_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_training_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.training_content_versions,public.organization_training_progress FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.training_eligible(p_org text,p_actor uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE perms jsonb;lim jsonb;role_name text;l public.licenses;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_actor AND deleted_at IS NULL AND(banned_until IS NULL OR banned_until<now())) THEN RETURN false;END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=p_org AND deleted_at IS NULL)
 OR (SELECT count(*) FROM public.organization_members WHERE organization_id=p_org AND user_id=p_actor AND lower(status)='active')<>1
 OR (SELECT count(*) FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE))<>1 THEN RETURN false;END IF;
 SELECT r.permissions,m.permission_limit,r.name INTO perms,lim,role_name FROM public.organization_members m
 JOIN public.roles r ON r.id=m.role_id AND r.organization_id=m.organization_id AND r.scope='organization'
 WHERE m.organization_id=p_org AND m.user_id=p_actor AND lower(m.status)='active' AND m.affiliation_type='internal';
 IF role_name IS NULL OR role_name NOT IN('admin_org','gestor','operacional') OR jsonb_typeof(perms) IS DISTINCT FROM 'array' THEN RETURN false;END IF;
 IF lim IS NOT NULL AND lim<>'null'::jsonb THEN SELECT coalesce(jsonb_agg(x),'[]') INTO perms FROM jsonb_array_elements(perms)x WHERE lim @> jsonb_build_array(x);END IF;
 SELECT * INTO l FROM public.licenses WHERE organization_id=p_org AND active AND lower(status)='active' AND start_date<=CURRENT_DATE AND(end_date IS NULL OR end_date>=CURRENT_DATE);
 RETURN (l.ccee_data AND perms?'f5364101-4486-42c2-a90f-807937ac3011')
 OR (l.ccee_registrations AND perms?'f5364101-4486-42c2-a90f-807937ac3001')
 OR (l.free_market_management AND perms?'60f9690a-145b-4dba-b23f-9f945baca296');
END$$;

CREATE FUNCTION public.training_state(p_org text,p_actor uuid,p_content text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.training_content_versions;r public.organization_training_progress;
BEGIN
 IF NOT public.training_eligible(p_org,p_actor) THEN RETURN jsonb_build_object('eligible',false);END IF;
 SELECT * INTO c FROM public.training_content_versions WHERE status='PUBLISHED' AND (p_org=ANY(organization_ids) OR '*'=ANY(organization_ids))
 AND(p_content IS NULL OR id=p_content) ORDER BY published_at DESC,id DESC LIMIT 1;
 IF c.id IS NULL THEN RETURN jsonb_build_object('eligible',false);END IF;
 SELECT * INTO r FROM public.organization_training_progress WHERE organization_id=p_org AND user_id=p_actor AND content_id=c.id;
 RETURN jsonb_build_object('eligible',true,'organizationId',p_org,'content',jsonb_build_object('id',c.id,'title',c.title,'version',c.version,'duration',c.duration_seconds,'mandatory',c.mandatory,'chapters',c.chapters),
 'progress',jsonb_build_object('position',coalesce(r.position_seconds,0),'percent',CASE WHEN r.completed_at IS NOT NULL THEN 100 ELSE least(99,round(100.0*coalesce(cardinality(r.watched),0)/c.duration_seconds)) END,'completedAt',r.completed_at,'revision',coalesce(r.revision,0)));
END$$;

CREATE FUNCTION public.training_command(p_org text,p_actor uuid,p_content text,p_action text,p_player uuid DEFAULT NULL,p_position double precision DEFAULT 0,p_playing boolean DEFAULT false,p_visible boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.training_content_versions;r public.organization_training_progress;elapsed double precision;delta double precision;lo integer;hi integer;done boolean;was_complete boolean;request uuid:=gen_random_uuid();
BEGIN
 IF NOT public.training_eligible(p_org,p_actor) THEN RAISE EXCEPTION 'Training scope unavailable' USING ERRCODE='42501';END IF;
 SELECT * INTO c FROM public.training_content_versions WHERE id=p_content AND status='PUBLISHED' AND(p_org=ANY(organization_ids) OR '*'=ANY(organization_ids)) FOR SHARE;
 IF c.id IS NULL OR p_action IS NULL OR p_action NOT IN('DEFER','OPEN','TICK','RELEASE') OR p_playing IS NULL OR p_visible IS NULL
 OR p_position IS NULL OR p_position<0 OR p_position>c.duration_seconds+2 OR p_position::text IN('NaN','Infinity','-Infinity') OR(p_action<>'DEFER' AND p_player IS NULL) THEN RAISE EXCEPTION 'Invalid training command' USING ERRCODE='22023';END IF;
 INSERT INTO public.organization_training_progress(organization_id,user_id,content_id)VALUES(p_org,p_actor,p_content)ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM public.organization_training_progress WHERE organization_id=p_org AND user_id=p_actor AND content_id=p_content FOR UPDATE;
 was_complete:=r.completed_at IS NOT NULL;
 IF p_action='DEFER' THEN r.deferred_at:=now();
 ELSIF p_action='OPEN' THEN
  IF r.player_id IS NOT NULL AND r.player_id<>p_player AND r.last_tick>now()-interval '45 seconds' THEN RAISE EXCEPTION 'Training already playing in another tab' USING ERRCODE='40001';END IF;
  r.player_id:=p_player;r.last_tick:=clock_timestamp();r.last_position:=p_position;r.playing:=false;
 ELSE
  IF r.player_id IS DISTINCT FROM p_player THEN RAISE EXCEPTION 'Training player changed; reopen safely' USING ERRCODE='40001';END IF;
  elapsed:=extract(epoch FROM clock_timestamp()-r.last_tick);delta:=p_position-r.last_position;
  -- Server time bounds credit, merging seconds rather than counting duplicate heartbeats.
  -- OPEN/seek/hidden/stale packets never credit skipped intervals; the last two seconds tolerate codec endings.
  IF r.playing AND p_visible AND elapsed BETWEEN 0 AND 40 AND delta>0 AND delta<=elapsed*2.05+0.75 THEN
   lo:=greatest(0,floor(r.last_position)::integer);hi:=least(c.duration_seconds-1,ceil(p_position)::integer-1);
   SELECT coalesce(array_agg(DISTINCT x ORDER BY x),'{}') INTO r.watched FROM unnest(r.watched||ARRAY(SELECT generate_series(lo,hi)))x;
  END IF;
  r.position_seconds:=least(p_position,c.duration_seconds);r.last_position:=p_position;r.last_tick:=clock_timestamp();r.playing:=p_playing AND p_visible;
  done:=cardinality(r.watched)>=c.duration_seconds-2 AND p_position>=c.duration_seconds-2;
  IF done AND r.completed_at IS NULL THEN r.completed_at:=now();END IF;
  IF p_action='RELEASE' THEN r.player_id:=NULL;r.playing:=false;END IF;
 END IF;
 UPDATE public.organization_training_progress SET watched=r.watched,position_seconds=r.position_seconds,completed_at=r.completed_at,deferred_at=r.deferred_at,
 player_id=r.player_id,last_tick=r.last_tick,last_position=r.last_position,playing=r.playing,revision=revision+1,updated_at=now()
 WHERE organization_id=p_org AND user_id=p_actor AND content_id=p_content;
 IF p_action IN('DEFER','OPEN') OR (NOT was_complete AND r.completed_at IS NOT NULL) THEN
  INSERT INTO public.energy_audit_events(id,organization_id,actor_id,module,action,resource,reason,result)
  VALUES(request,p_org,p_actor::text,'training',CASE WHEN NOT was_complete AND r.completed_at IS NOT NULL THEN 'TRAINING_COMPLETED' ELSE 'TRAINING_'||p_action END,p_content,'Treinamento operacional; não altera permissões ou decisões financeiras.','SUCCESS');
 END IF;
 RETURN public.training_state(p_org,p_actor,p_content);
END$$;

REVOKE ALL ON FUNCTION public.training_eligible(text,uuid),public.training_state(text,uuid,text),public.training_command(text,uuid,text,text,uuid,double precision,boolean,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.training_state(text,uuid,text),public.training_command(text,uuid,text,text,uuid,double precision,boolean,boolean) TO service_role;
-- Restrictive deny remains effective even if another bucket has permissive policies.
CREATE POLICY training_private_client_deny ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated USING(bucket_id<>'energy-training-private') WITH CHECK(bucket_id<>'energy-training-private');
-- The generic media bucket is private.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
 VALUES('energy-training-private','energy-training-private',false,209715200,ARRAY['video/mp4','text/vtt','application/pdf','image/png','application/json','text/plain']) ON CONFLICT(id) DO NOTHING;
DO $$BEGIN IF EXISTS(SELECT 1 FROM storage.buckets WHERE id='energy-training-private' AND public) THEN RAISE EXCEPTION 'Training bucket must be private';END IF;END$$;
INSERT INTO public.training_content_versions(id,title,version,duration_seconds,asset_prefix,organization_ids)
 VALUES('ccee-operations-v2','Rotinas operacionais da CCEE: agenda, EVA e publicação','2.0',600,'ccee/v2/',ARRAY['org_default']);
CREATE FUNCTION public.training_publish(p_actor uuid,p_duration integer,p_hash text,p_chapters jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 PERFORM public.assert_license_platform_actor(p_actor);
 IF p_duration IS NULL OR p_duration NOT BETWEEN 30 AND 7200 OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR jsonb_typeof(p_chapters) IS DISTINCT FROM 'array' OR jsonb_array_length(p_chapters) NOT BETWEEN 1 AND 60
 OR (SELECT count(*) FROM storage.objects WHERE bucket_id='energy-training-private' AND name IN('ccee/v2/video.mp4','ccee/v2/legendas.vtt','ccee/v2/poster.png','ccee/v2/guia.pdf','ccee/v2/transcricao.txt'))<>5 THEN RAISE EXCEPTION 'Reviewed training media required' USING ERRCODE='22023';END IF;
 UPDATE public.training_content_versions SET duration_seconds=p_duration,media_hash=p_hash,chapters=p_chapters,status='PUBLISHED',mandatory=true,published_at=now() WHERE id='ccee-operations-v2' AND status='DRAFT';
 IF NOT FOUND THEN RAISE EXCEPTION 'Training version already published or missing' USING ERRCODE='40001';END IF;
 INSERT INTO public.energy_audit_events(id,actor_id,module,action,resource,reason,result)VALUES(gen_random_uuid(),p_actor::text,'training','TRAINING_PUBLISHED','ccee-operations-v2','Mídia demonstrativa revisada e publicada; ativação inicial na organização autorizada.','SUCCESS');
 RETURN jsonb_build_object('id','ccee-operations-v2','status','PUBLISHED','duration',p_duration);
END$$;
REVOKE ALL ON FUNCTION public.training_publish(uuid,integer,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.training_publish(uuid,integer,text,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;

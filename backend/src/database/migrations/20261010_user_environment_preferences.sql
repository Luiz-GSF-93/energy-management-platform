-- Personal data is separate from administrator-owned identity and immutable business audit.
BEGIN;
CREATE TABLE public.user_environment_preferences (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 revision integer NOT NULL CHECK(revision>0),
 theme text NOT NULL CHECK(theme IN ('blue','light','graphite')),
 avatar_kind text NOT NULL CHECK(avatar_kind IN ('initials','emoji','photo')),
 emoji text NOT NULL CHECK(emoji IN ('🙂','😎','🌿','⚡')),
 photo text NOT NULL DEFAULT '' CHECK(length(photo)<=82000 AND (photo='' OR photo LIKE 'data:image/png;base64,%')),
 cep text NOT NULL DEFAULT '' CHECK(cep='' OR cep~'^[0-9]{8}$'),
 personal_phone text NOT NULL DEFAULT '' CHECK(personal_phone='' OR personal_phone~'^\+?[0-9 ()-]{8,25}$'),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.user_environment_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 revision integer NOT NULL,changed_fields text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,revision)
);
ALTER TABLE public.user_environment_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_environment_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.user_environment_preferences,public.user_environment_events FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.user_environment_preferences TO service_role;
GRANT SELECT,INSERT ON public.user_environment_events TO service_role;
CREATE FUNCTION public.save_user_environment_preferences(p_user uuid,p_revision integer,p_data jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old public.user_environment_preferences; saved public.user_environment_preferences; changed text[];
BEGIN
 IF p_user IS NULL OR p_revision<0 OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_data) k WHERE k NOT IN ('revision','theme','avatar_kind','emoji','photo','cep','personal_phone')) THEN RAISE EXCEPTION 'Invalid preference input' USING ERRCODE='22023'; END IF;
 -- Serialize concurrent first saves as well as updates. No quota/tenant tables are touched.
 PERFORM pg_advisory_xact_lock(hashtextextended('user_environment:'||p_user::text,0));
 SELECT * INTO old FROM user_environment_preferences WHERE user_id=p_user FOR UPDATE;
 IF coalesce(old.revision,0)<>p_revision THEN RAISE EXCEPTION 'Preference version changed' USING ERRCODE='40001'; END IF;
 SELECT coalesce(array_agg(k ORDER BY k),ARRAY[]::text[]) INTO changed FROM jsonb_object_keys(p_data) k WHERE k<>'revision' AND (to_jsonb(old)->k) IS DISTINCT FROM (p_data->k);
 INSERT INTO user_environment_preferences(user_id,revision,theme,avatar_kind,emoji,photo,cep,personal_phone)
 VALUES(p_user,p_revision+1,p_data->>'theme',p_data->>'avatar_kind',p_data->>'emoji',p_data->>'photo',p_data->>'cep',p_data->>'personal_phone')
 ON CONFLICT(user_id) DO UPDATE SET revision=EXCLUDED.revision,theme=EXCLUDED.theme,avatar_kind=EXCLUDED.avatar_kind,emoji=EXCLUDED.emoji,photo=EXCLUDED.photo,cep=EXCLUDED.cep,personal_phone=EXCLUDED.personal_phone,updated_at=now() RETURNING * INTO saved;
 INSERT INTO user_environment_events(user_id,revision,changed_fields) VALUES(p_user,saved.revision,changed);
 RETURN to_jsonb(saved)-'user_id';
END; $$;
REVOKE ALL ON FUNCTION public.save_user_environment_preferences(uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_user_environment_preferences(uuid,integer,jsonb) TO service_role;
COMMIT;

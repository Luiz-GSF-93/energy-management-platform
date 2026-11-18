// Privileged credentials are server-only. New Supabase secret keys are not JWTs.
export function supabaseServerHeaders(env){
  const key=env.SUPABASE_SERVER_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(typeof key!=='string'||!key||/\s/.test(key))throw new Error('Supabase server credential missing or invalid');
  const headers={apikey:key,'Content-Type':'application/json',Prefer:'return=representation'};
  if(key.startsWith('sb_secret_'))return headers;
  try{
    const parts=key.split('.');
    if(parts.length!==3||JSON.parse(Buffer.from(parts[1],'base64url')).role!=='service_role')throw new Error();
  }catch{
    throw new Error('Use a Supabase secret key or a legacy service_role credential, only on the server');
  }
  return {...headers,Authorization:'Bearer '+key};
}

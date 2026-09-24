// Run from backend with its existing server environment. Never prints credentials.
require('dotenv').config({ quiet: true });
const { createClient } = require('@supabase/supabase-js');
const assert = require('node:assert/strict');
(async () => {
  assert(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY, 'Server environment required');
  const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY,{auth:{persistSession:false}});
  const id='energy-documents-private';
  let result=await client.storage.getBucket(id);
  if(result.error) {
    // Only create for a confirmed absent bucket; never mask permission/network errors.
    assert(String(result.error.statusCode)==='404' || result.error.message==='Bucket not found', 'Unable to inspect bucket');
    const created=await client.storage.createBucket(id,{public:false,fileSizeLimit:10485760,allowedMimeTypes:['application/pdf','image/jpeg','image/png']});
    assert(!created.error,'Unable to create private document bucket');result=await client.storage.getBucket(id);
  }
  assert(!result.error && result.data?.public===false,'Bucket must remain private');
  assert(Number(result.data.file_size_limit)===10485760,'Unexpected bucket size limit');
  assert.deepEqual([...result.data.allowed_mime_types].sort(),['application/pdf','image/jpeg','image/png'].sort());
  console.log('Private bucket verified: 10 MiB, PDF/JPEG/PNG');
})().catch(()=>{ console.error('Document storage configuration failed; inspect configuration without exposing credentials');process.exitCode=1; });

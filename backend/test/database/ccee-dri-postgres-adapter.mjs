// Disposable local Docker database only; no remote URLs or production credentials.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
export function driPostgresAdapter(container){
 if(!/^ccee-dri-lab-[a-z0-9-]+$/.test(container))throw Error('Use a named disposable DRI lab container');
 const sql=async text=>(await run('docker',['exec',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',text],{maxBuffer:4000000,timeout:45000})).stdout.trim();
 const literal=v=>v==null?'NULL':typeof v==='boolean'||typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
 return{exec:sql,close:async()=>{},query:async(text,params=[])=>{
  const expanded=text.replace(/\$(\d+)/g,(_,i)=>literal(params[Number(i)-1]));
  if(!/^\s*SELECT/i.test(expanded)){await sql(expanded);return{rows:[]};}
  return{rows:JSON.parse(await sql("SELECT coalesce(json_agg(row_to_json(q)),'[]') FROM ("+expanded+") q"))};
 }};
}

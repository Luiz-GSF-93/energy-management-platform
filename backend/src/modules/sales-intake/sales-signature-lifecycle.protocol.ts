import {createHash} from 'node:crypto';
import {SignatureClaim,signatureOperation} from './sales-signature.adapter';
export const signatureUuid=/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export type SignatureContext={id:string;requestId:string;draftSha256:string;parties:SignatureClaim['source']['parties'];resources:{ordinal:number;external_id:string;type:string}[];replayed?:boolean};
export type SignatureProof={envelopeId:string;documentId:string;status:'DRAFT'|'RUNNING'|'SIGNED'|'CANCELED';signedAt:string|null;signers:string[];log:{id:string;name:string;occurredAt:string;signerId:string|null}[];environment:'SANDBOX';realActivationEligible:false};
export function signatureResources(c:SignatureContext){
 if(!signatureUuid.test(c.id)||!Array.isArray(c.resources)||c.resources.length!==8)throw Error('Incomplete resources');
 const ids=c.resources.map((r,i)=>{if(r.ordinal!==i+1||!signatureUuid.test(r.external_id)||r.type!==(i===0?'envelopes':i===1?'documents':i<4?'signers':'requirements'))throw Error('Divergent resource');return r.external_id;});
 if(new Set(ids).size!==8)throw Error('Duplicated resources');return ids;
}
function collection(raw:any,count:number){
 // A missing pagination contract is incomplete, rather than assuming the first page is complete.
 if(!Array.isArray(raw?.data)||raw.data.length!==count||!raw.links||!Object.prototype.hasOwnProperty.call(raw.links,'next')||raw.links.next!==null||new Set(raw.data.map((r:any)=>r?.id)).size!==count)throw Error('Incomplete collection');
 return raw.data;
}
export function signatureFullProof(c:SignatureContext,parent:any,docs:any,signers:any,requirements:any,document:any,events?:any):SignatureProof{
 const ids=signatureResources(c),env=parent?.data;
 if(env?.id!==ids[0]||env.type!=='envelopes'||env.attributes?.name!==`EnergyOS HOMOLOGAÇÃO ${c.id}`||env.attributes?.auto_close!==(env.attributes?.status==='draft'?false:true)||!['draft','running','closed','canceled'].includes(env.attributes?.status))throw Error('Envelope mismatch');
 const d=collection(docs,1)[0];
 if(d.id!==ids[1]||d.type!=='documents'||d.attributes?.filename!==`energyos-sandbox-${c.id}.pdf`||document?.data?.id!==d.id||document.data.type!=='documents'||document.data.attributes?.filename!==d.attributes.filename||document.data.attributes?.status!==d.attributes.status)throw Error('Document mismatch');
 const ss=collection(signers,2);
 for(let i=0;i<2;i++){
  const s=ss.find((r:any)=>r.id===ids[i+2]),p=c.parties[i===0?'supplier':'customer'];
  if(!s||s.type!=='signers'||s.attributes?.name!==p.signatory||s.attributes?.email!==p.email||s.attributes?.communicate_events?.signature_request!=='email'||s.attributes?.communicate_events?.signature_reminder!=='none'||s.attributes?.group!==1)throw Error('Signer mismatch');
 }
 const rs=collection(requirements,4);
 for(let ordinal=5;ordinal<=8;ordinal++){
  const r=rs.find((x:any)=>x.id===ids[ordinal-1]);
  const claim:SignatureClaim={id:c.id,lease:c.requestId,ordinal,step:['QUAL_SUPPLIER','AUTH_SUPPLIER','QUAL_CUSTOMER','AUTH_CUSTOMER'][ordinal-5] as any,source:{draftSha256:c.draftSha256,parties:c.parties},dependencies:{envelope:ids[0],document:ids[1],supplier:ids[2],customer:ids[3]}};
  const expected=signatureOperation(claim).body.data as any;
  if(!r||r.type!=='requirements'||r.attributes?.action!==expected.attributes.action||(r.attributes?.role??null)!==(expected.attributes.role??null)||(r.attributes?.auth??null)!==(expected.attributes.auth??null))throw Error('Requirement mismatch');
  for(const k of ['document','signer'])if(r.relationships?.[k]?.data?.id!==expected.relationships[k].data.id||r.relationships[k].data.type!==expected.relationships[k].data.type)throw Error('Requirement relationship mismatch');
 }
 const proof:SignatureProof={envelopeId:ids[0],documentId:ids[1],status:env.attributes.status==='draft'?'DRAFT':env.attributes.status==='running'?'RUNNING':env.attributes.status==='canceled'?'CANCELED':'SIGNED',signedAt:null,signers:ids.slice(2,4),log:[],environment:'SANDBOX',realActivationEligible:false};
 if(proof.status==='DRAFT'&&d.attributes.status!=='draft'||proof.status==='RUNNING'&&d.attributes.status!=='running'||proof.status==='CANCELED'&&d.attributes.status!=='canceled'||proof.status==='SIGNED'&&d.attributes.status!=='closed')throw Error('Inconsistent status');
 if(proof.status==='SIGNED'){
  if(!Array.isArray(events?.data)||events.data.length<2||events.data.length>200||events.links?.next!==null)throw Error('Incomplete events');
  const seen=new Set<string>();
  for(const e of events.data){
   const a=e?.attributes,t=a?.occurred_at;
   if(e.type!=='events'||!signatureUuid.test(e.id)||seen.has(e.id)||typeof a?.name!=='string'||!/^[a-z_]{1,60}$/.test(a.name)||typeof t!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(t)||!Number.isFinite(Date.parse(t))||Date.parse(t)>Date.now()+300000)throw Error('Invalid event');
   seen.add(e.id);if(['cancel','refusal','deadline'].includes(a.name))throw Error('Adverse signature event');
   const signer=a.name==='sign'?a.data?.signer?.key:null;
   if(a.name==='sign'&&!proof.signers.includes(signer))throw Error('Unbound signature');
   proof.log.push({id:e.id,name:a.name,occurredAt:new Date(t).toISOString(),signerId:signer});
  }
  if(!proof.signers.every(id=>proof.log.some(e=>e.name==='sign'&&e.signerId===id)))throw Error('Partial signatures');
  proof.signedAt=proof.log.filter(e=>e.name==='sign').map(e=>e.occurredAt).sort().at(-1)!;
 }
 return proof;
}
export function signatureWebhookEvent(raw:Buffer,account:string){
 const body=JSON.parse(raw.toString('utf8')),event=body?.event,doc=body?.document;
 if(!signatureUuid.test(account)||event?.data?.account?.key!==account||!signatureUuid.test(doc?.key)||doc.account_key!==account||typeof event.name!=='string'||!/^[a-z_]{1,60}$/.test(event.name)||typeof event.occurred_at!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(event.occurred_at)||!Number.isFinite(Date.parse(event.occurred_at))||Date.parse(event.occurred_at)>Date.now()+300000)throw Error('Invalid webhook link');
 const value={account,documentId:doc.key,name:event.name,occurredAt:new Date(event.occurred_at).toISOString(),signerId:event.name==='sign'?event.data?.signer?.key??null:null};
 if(value.signerId!==null&&!signatureUuid.test(value.signerId))throw Error('Invalid event signer');
 return {...value,eventHash:createHash('sha256').update(JSON.stringify(value)).digest('hex')};
}

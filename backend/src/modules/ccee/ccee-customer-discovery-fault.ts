import {XMLParser,XMLValidator} from 'fast-xml-parser';
const SOAP='http://schemas.xmlsoap.org/soap/envelope/';
/** Strict no-data business fault for the CNPJ lookup service only. */
export function participantNoData(xml:string,status:number){
 if(status!==500||Buffer.byteLength(xml)>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return false;
 try{
  const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false,trimValues:true}).parse(xml);
  if(Object.keys(parsed).filter(k=>!k.startsWith('?')).length!==1)return false;
  const child=(parent:any,name:string,scope:Record<string,string>,namespace?:string)=>{
   const keys=Object.keys(parent??{}).filter(k=>!k.startsWith('@_')&&k.split(':').pop()===name);if(keys.length!==1)throw Error('shape');
   const key=keys[0],node=parent[key];if(!node||typeof node!=='object'||Array.isArray(node))throw Error('shape');const ns={...scope};
   for(const [k,v] of Object.entries(node))if(k==='@_xmlns')ns['']=String(v);else if(k.startsWith('@_xmlns:'))ns[k.slice(8)]=String(v);
   if(namespace&&ns[key.includes(':')?key.split(':')[0]:'']!==namespace)throw Error('namespace');return{node,ns};
  };
  const envelope=child(parsed,'Envelope',{},SOAP),body=child(envelope.node,'Body',envelope.ns,SOAP),fault=child(body.node,'Fault',body.ns,SOAP);
  if(Object.keys(body.node).filter(k=>!k.startsWith('@_')).length!==1)return false;
  const scalar=(name:string)=>{const keys=Object.keys(fault.node).filter(k=>k.split(':').pop()===name);return keys.length===1&&typeof fault.node[keys[0]]==='string'?fault.node[keys[0]]:null;};
  if(!/^(?:[A-Za-z_][\w.-]*:)?Server\.3001$/.test(scalar('faultcode')??''))return false;
  const detail=child(fault.node,'detail',fault.ns),noData=child(detail.node,'noDataFoundFault',detail.ns);
  const key=Object.keys(detail.node).find(k=>!k.startsWith('@_')&&k.split(':').pop()==='noDataFoundFault')!;
  // Fault details must belong to the CCEE namespace, never an arbitrary vendor element.
  const uri=noData.ns[key.includes(':')?key.split(':')[0]:''];
  if(uri!=='http://xmlns.energia.org.br/FM/v2'||Object.keys(detail.node).filter(k=>!k.startsWith('@_')).length!==1)return false;
  const value=(name:string)=>{const entries=Object.keys(noData.node).filter(k=>!k.startsWith('@_')&&k.split(':').pop()===name);if(entries.length!==1)return null;const k=entries[0];return noData.ns[k.includes(':')?k.split(':')[0]:'']===uri&&typeof noData.node[k]==='string'?noData.node[k]:null;};
  return value('errorCode')==='3001'&&value('uri')==='/ws/v2/ParticipanteMercadoBSv2';
 }catch{return false;}
}

/** Informational metadata only; never changes authorization or no-data classification. */
export function participantFaultMetadata(xml:string,secrets:readonly string[]=[]){
 if(Buffer.byteLength(xml)>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return null;
 try{
  const p=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:true,trimValues:true}).parse(xml);
  const keys=Object.keys(p).filter(k=>!k.startsWith('?'));if(keys.length!==1)return null;
  const root=p[keys[0]],prefix=keys[0].split(':').length===2?keys[0].split(':')[0]:'';
  if(keys[0].split(':').pop()!=='Envelope'||root[prefix?'@_xmlns:'+prefix:'@_xmlns']!==SOAP)return null;
  const local=(o:any,n:string)=>{const ks=Object.keys(o??{}).filter(k=>!k.startsWith('@_')&&k.split(':').pop()===n);return ks.length===1?o[ks[0]]:null;};
  const fault=local(local(root,'Body'),'Fault'),code=local(fault,'faultcode');if(typeof code!=='string'||!/^([A-Za-z_][\w.-]*:)?(?:Server|Client)\.[0-9]{4}$/.test(code))return null;
  const detail=local(fault,'detail'),dk=Object.keys(detail??{}).filter(k=>!k.startsWith('@_'));const payload=dk.length===1?detail[dk[0]]:null;
  const headerId=local(local(local(root,'Header'),'messageHeader'),'transactionId'),detailId=local(payload,'transactionId');
  const ids=[headerId,detailId].filter((v):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v));
  const rawUri=local(payload,'uri'),rawMessage=local(payload,'message');let message=typeof rawMessage==='string'?rawMessage:'';
  const escaped=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  for(const secret of [...secrets].filter(Boolean).sort((a,b)=>b.length-a.length))for(const variant of [secret,escaped(secret)])message=message.split(variant).join('[redacted]');
  message=message.replace(/(?:Bearer\s+|\beyJ)[A-Za-z0-9_.-]+/gi,'[redacted]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/\d{7,}/g,'[number]').replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim().slice(0,500);
  return{code,transactionId:new Set(ids).size===1?ids[0]:null,uri:typeof rawUri==='string'&&/^\/ws\/[A-Za-z0-9/_-]{1,150}$/.test(rawUri)&&!secrets.filter(Boolean).some(s=>rawUri.includes(s))?rawUri:null,message:message||null};
 }catch{return null;}
}

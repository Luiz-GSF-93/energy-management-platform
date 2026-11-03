import {XMLParser,XMLValidator} from 'fast-xml-parser';
const SOAP='http://schemas.xmlsoap.org/soap/envelope/';
/** CCEE ticket 00460253: only this SOAP business fault means no report catalog. */
export function driNoReports(xml:string,kind:string,status:number){
 if(kind!=='DRI_REPORTS'||status!==500||Buffer.byteLength(xml)>2097152||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)return false;
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
  return value('errorCode')==='3001'&&value('uri')==='/ws/v2/RelatorioBSv2';
 }catch{return false;}
}

import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {createHash} from 'node:crypto';
import {validateCceePld} from './ccee-validation';
import {calculateMonthlyMarketReference} from '../energy-prices/market-reference-calculation';

const SOAP='http://schemas.xmlsoap.org/soap/envelope/';
const list=(value:any):any[]=>value===undefined?[]:Array.isArray(value)?value:[value];
// Keep namespaces until they have been checked: a similarly named foreign node is not a CCEE response.
function child(node:any,name:string,namespace:string,inherited:Record<string,string>):{node:any;ns:Record<string,string>} {
  const matches=Object.entries(node??{}).filter(([key])=>!key.startsWith('@_')&&key.split(':').pop()===name);
  if(matches.length!==1) throw new Error('CCEE_INVALID_RESPONSE');
  const [key,value]=matches[0];
  const ns={...inherited};
  if(value&&typeof value==='object')for(const [attribute,uri] of Object.entries(value))if(attribute.startsWith('@_xmlns:'))ns[attribute.slice(8)]=String(uri);else if(attribute==='@_xmlns')ns['']=String(uri);
  const prefix=key.includes(':')?key.split(':')[0]:'';
  if(ns[prefix]!==namespace||Array.isArray(value)) throw new Error('CCEE_INVALID_RESPONSE');
  return {node:value,ns};
}
export function parseCcee(xml:string,kind:'profile'|'pld',page:number) {
  if(Buffer.byteLength(xml)>2*1024*1024||/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true)throw new Error('CCEE_INVALID_RESPONSE');
  const raw=new XMLParser({ignoreAttributes:false,parseTagValue:false,processEntities:false,trimValues:true}).parse(xml);
  const envelope=child(raw,'Envelope',SOAP,{});
  const body=child(envelope.node,'Body',SOAP,envelope.ns);
  if(Object.keys(body.node??{}).some(key=>key.split(':').pop()==='Fault'))throw new Error('CCEE_SOAP_FAULT');
  const version=kind==='profile'?'v2':'v1';
  const response=child(body.node,kind==='profile'?'listarPerfilParticipanteMercadoResponse':'listarPLDResponse',`http://xmlns.energia.org.br/BM/${version}`,body.ns);
  const header=child(envelope.node,'Header',SOAP,envelope.ns);
  const pagination=child(header.node,'paginacao',`http://xmlns.energia.org.br/MH/${version}`,header.ns);
  // Namespace validation above protects the SOAP boundary; local names simplify CCEE business data only.
  const strip=(value:any,ns:Record<string,string>,allowed:string[],depth=0):any=>{
    if(depth>30)throw new Error('CCEE_INVALID_RESPONSE');
    if(Array.isArray(value))return value.map(v=>strip(v,ns,allowed,depth+1));
    if(!value||typeof value!=='object')return value;
    const local={...ns};for(const [attribute,uri] of Object.entries(value))if(attribute.startsWith('@_xmlns:'))local[attribute.slice(8)]=String(uri);else if(attribute==='@_xmlns')local['']=String(uri);
    const output:Record<string,any>={};
    for(const [key,entry] of Object.entries(value)){
      if(key.startsWith('@_'))continue;
      const name=key.split(':').pop()!;
      const sample=Array.isArray(entry)?entry[0]:entry;
      const childNs={...local};if(sample&&typeof sample==='object')for(const [attribute,uri] of Object.entries(sample))if(attribute.startsWith('@_xmlns:'))childNs[attribute.slice(8)]=String(uri);else if(attribute==='@_xmlns')childNs['']=String(uri);
      if(key==='#text'||name in output||!allowed.includes(childNs[key.includes(':')?key.split(':')[0]:'']))throw new Error('CCEE_INVALID_RESPONSE');
      output[name]=strip(entry,childNs,allowed,depth+1);
    }
    return output;
  };
  const p=strip(pagination.node,pagination.ns,[`http://xmlns.energia.org.br/MH/${version}`]);const pages=Number(p.totalPaginas);const total=Number(p.quantidadeTotalItens);
  if(Number(p.numero)!==page||!Number.isInteger(pages)||pages<1||pages>20||!Number.isInteger(total)||total<0||total>744||page>pages)throw new Error('CCEE_INVALID_PAGINATION');
  return {body:strip(response.node,response.ns,[`http://xmlns.energia.org.br/BM/${version}`,`http://xmlns.energia.org.br/BO/${version}`]),pages,total,hash:createHash('sha256').update(xml).digest('hex')};
}
export function profilePresent(body:any,profile:string):boolean {
  return list(body?.perfis?.perfil).some(value=>String(value?.codigo)===profile);
}
export type PldHour={start:string;end:string;submarket:'SE_CO'|'S'|'NE'|'N';value:number};
export function pldHours(body:any,month:string):PldHour[] {
  const markets:Record<string,PldHour['submarket']>={'1':'SE_CO','2':'S','3':'NE','4':'N'};
  const rows:PldHour[]=[];
  for(const pld of list(body?.plds?.pld)) {
    const start=pld?.vigencia?.inicio,end=pld?.vigencia?.fim;
    if(typeof start!=='string'||typeof end!=='string'||!start.startsWith(month+'-')||!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00-03:00$/.test(start)||!/^\d{4}-\d{2}-\d{2}T\d{2}:00:00-03:00$/.test(end)||Date.parse(end)-Date.parse(start)!==3600000)throw new Error('CCEE_INVALID_HOUR');
    const values=list(pld?.valores?.valor);
    if(values.length!==4)throw new Error('CCEE_INCOMPLETE_MARKETS');
    const seen=new Set<string>();
    for(const entry of values) {
      const submarket=markets[String(entry?.submercado?.codigo)];
      const prices=list(entry?.valor).filter(v=>v?.codigo==='BRL');
      const value=prices[0]?.valor;
      if(!submarket||seen.has(submarket)||entry?.tipo!=='HORARIO'||entry?.indicadorRedeEletrica!=='false'||prices.length!==1||typeof value!=='string'||!/^\d{1,8}(\.\d{1,6})?$/.test(value))throw new Error('CCEE_INVALID_PRICE');
      seen.add(submarket);rows.push({start,end,submarket,value:Number(value)});
    }
  }
  return rows;
}
export function monthlyPld(rows:PldHour[],month:string) {
 return calculateMonthlyMarketReference(validateCceePld(rows,month),month);
}

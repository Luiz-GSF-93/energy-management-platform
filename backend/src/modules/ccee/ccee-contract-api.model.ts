import {createHash} from 'node:crypto';
import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {cceeMonth,cceeObject,cceeText,cceeUuid} from './ccee-data.model';
import {CceeConfig,soapRequest,xmlEscape} from './ccee-config';
import {CceeReadingError,privateEnvelope} from './ccee-private.connector';
export const CONTRACT_SERVICES={CONTRACTS:{path:'/ws/v2/ContratoBSv2',action:'listarContrato'},AMOUNTS:{path:'/ws/v2/MontanteEnergiaBSv2',action:'listarMontanteEnergia'},PROCESSING:{path:'/ws/cntr/ResultadoProcessamentoBSv1',action:'obterResultadoProcessamento'}} as const;
export type ContractRead=keyof typeof CONTRACT_SERVICES;
export const contractHash=(v:string)=>createHash('sha256').update(v).digest('hex');
const many=(v:any):any[]=>v==null||v===''?[]:Array.isArray(v)?v:[v];
const id=(v:unknown)=>{if(typeof v!=='string'||!/^\d{1,20}$/.test(v))throw new CceeReadingError('CONTRACT_IDENTIFIER_REQUIRED');return v;};
export function contractQuery(input:unknown){
 const b=cceeObject(input,['requestId','authorizationId','month','operation','role','reason','confirmed'],['parentId','contractId','amountKind']);
 cceeUuid(b.requestId);cceeUuid(b.authorizationId);cceeMonth(b.month);cceeText(b.reason,1000,10);
 if(!['CONTRACTS','AMOUNTS'].includes(b.operation)||!['COMPRADOR','VENDEDOR'].includes(b.role)||b.confirmed!==true)throw new CceeReadingError('CONFIRM_CONTRACT_READ_SCOPE');
 if(b.operation==='AMOUNTS'){cceeUuid(b.parentId);id(b.contractId);if(!['MONTANTE_MEDIO','MONTANTE_MODULARIZADO'].includes(b.amountKind))throw new CceeReadingError('AMOUNT_KIND_REQUIRED');}
 else if(['parentId','contractId','amountKind'].some(k=>b[k]!==undefined))throw new CceeReadingError('INVALID_CONTRACT_QUERY');
 return b;
}
export function contractSoap(c:CceeConfig,q:any,page:number){
 if(!['CONTRACTS','AMOUNTS'].includes(q.operation)||!['COMPRADOR','VENDEDOR'].includes(q.role)||!/^\d{1,12}$/.test(c.profile))throw new CceeReadingError('INVALID_CONTRACT_QUERY');
 cceeMonth(q.month);if(!Number.isInteger(page)||page<1||page>5)throw new CceeReadingError('REQUEST_LIMIT');
 const n=new Date(Date.UTC(Number(q.month.slice(0,4)),Number(q.month.slice(5,7)),0)).getUTCDate();
 const period=`<bm:periodoReferencia><bo:inicio>${q.month}-01T00:00:00-03:00</bo:inicio><bo:fim>${q.month}-${n}T23:59:59-03:00</bo:fim></bm:periodoReferencia>`;
 let body:string;
 if(q.operation==='CONTRACTS')body=`<bm:listarContratoRequest>${period}<bm:perfis><bo:perfil><bo:id>${c.profile}</bo:id></bo:perfil></bm:perfis><bm:papel>${q.role}</bm:papel><bm:listarMontantesNaoValidados>false</bm:listarMontantesNaoValidados><bm:ambienteContratacao><bo:nome>LIVRE</bo:nome></bm:ambienteContratacao></bm:listarContratoRequest>`;
 else{if(!['MONTANTE_MEDIO','MONTANTE_MODULARIZADO'].includes(q.amountKind))throw new CceeReadingError('AMOUNT_KIND_REQUIRED');body=`<bm:listarMontanteEnergiaRequest><bm:contratos><bo:contrato><bo:id>${id(q.contractId)}</bo:id></bo:contrato></bm:contratos>${period}<bm:tipos><bo:tipoMontanteEnergia><bo:nome>${q.amountKind}</bo:nome></bo:tipoMontanteEnergia></bm:tipos><bm:listarMontantesNaoValidados>false</bm:listarMontantesNaoValidados></bm:listarMontanteEnergiaRequest>`;}
 return soapRequest(c,'profile',page).replace('<mh:quantidadeItens>2</mh:quantidadeItens>','<mh:quantidadeItens>100</mh:quantidadeItens>').replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,`<soapenv:Body>${body}</soapenv:Body>`);
}
export function contractPage(xml:string,q:any,profile:string,page:number){
 const p=privateEnvelope(xml,2,CONTRACT_SERVICES[q.operation as 'CONTRACTS'|'AMOUNTS'].action+'Response',['contrato','vigenciaContrato','participanteMercado','perfil','indicador','montanteEnergia']);
 const pg=p.pagination,total=Number(pg?.quantidadeTotalItens),pages=Number(pg?.totalPaginas);
 if(Number(pg?.numero)!==page||!Number.isInteger(total)||total<0||total>500||!Number.isInteger(pages)||pages<1||pages>5)throw new CceeReadingError('CONTRACT_PAGINATION_REVIEW');
 const key=q.operation==='CONTRACTS'?'contratos':'montantes';if(!Object.prototype.hasOwnProperty.call(p.body,key))throw new CceeReadingError('CONTRACT_SCHEMA_REVIEW');
 const rows=q.operation==='CONTRACTS'?many(p.body.contratos?.contrato).map(r=>{
  id(r.id);const versions=many(r.vigencias?.vigenciaContrato);
  if(!versions.length||versions.length>100||!versions.some(v=>many(v.participantesMercado?.participanteMercado).some(a=>a.tipo?.descricao===q.role&&many(a.perfis?.perfil).some(x=>x.id===profile))))throw new CceeReadingError('CONTRACT_PARTICIPANT_PROOF_REQUIRED');
  return r;
 }):many(p.body.montantes?.montanteEnergia).map(r=>{
  if(id(r.contrato?.id)!==q.contractId||typeof r.quantidade?.valor!=='string'||!/^\d{1,15}(\.\d{1,8})?$/.test(r.quantidade.valor)||!['MWm','MWmed','MWmedio','MWh'].includes(r.quantidade.unidadeMedida))throw new CceeReadingError('CONTRACT_AMOUNT_OR_UNIT_REVIEW');
  const stamp=r.periodoReferencia?.inicio??r.periodoVigencia?.inicio;if(typeof stamp!=='string'||!/^20\d{2}-\d{2}-\d{2}T/.test(stamp)||!Number.isFinite(Date.parse(stamp)))throw new CceeReadingError('CONTRACT_PERIOD_REVIEW');
  return r;
 });
 if(rows.length>100||rows.length>total)throw new CceeReadingError('CONTRACT_ROW_LIMIT');return{...p,rows,total,pages};
}
export function preparedContractFile(xml:unknown){
 if(typeof xml!=='string'||Buffer.byteLength(xml)>524288||/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<\s*(?:\w+:)?(?:Security|Password|Username|Envelope)\b/i.test(xml)||XMLValidator.validate(xml)!==true)throw new CceeReadingError('INVALID_CONTRACT_FILE');
 const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false}).parse(xml);
 const keys=Object.keys(parsed).filter(k=>!k.startsWith('?'));if(keys.length!==1||keys[0]!=='ContratosCCEAL'||!parsed.ContratosCCEAL||many(parsed.ContratosCCEAL.Contrato).length<1||many(parsed.ContratosCCEAL.Contrato).length>100)throw new CceeReadingError('CONTRACT_FILE_LAYOUT_REVIEW');
 return{xml,hash:contractHash(xml),contracts:many(parsed.ContratosCCEAL.Contrato).length,bytes:Buffer.byteLength(xml),schemaValidated:false,transmissionEnabled:false};
}
export function processingSoap(c:CceeConfig,code:string){
 id(code);const header=soapRequest(c,'profile',1).replace(/v2/g,'v1').replace('<mh:versao>2.1</mh:versao>','').replace(/<mh:paginacao>[\s\S]*?<\/mh:paginacao>/,'');
 return header.replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,`<soapenv:Body><bm:obterResultadoProcessamentoRequest><bm:processamento><bo:codigoProcessamento>${xmlEscape(code)}</bo:codigoProcessamento><bo:tipoProcessamento>IMPORTACAO_CONTRATOS</bo:tipoProcessamento></bm:processamento></bm:obterResultadoProcessamentoRequest></soapenv:Body>`);
}

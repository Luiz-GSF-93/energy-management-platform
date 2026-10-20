import {BadRequestException,ServiceUnavailableException} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {cceeMonth,cceeObject,cceeUuid} from './ccee-data.model';
import {CceeConfig,soapRequest,xmlEscape} from './ccee-config';
import {privateEnvelope,CceeReadingError} from './ccee-private.connector';
export const DRI_SERVICES={DRI_EVENTS:{path:'/ws/v2/DivulgacaoEventoContabilBSv2',action:'listarDivulgacaoEventoContabil'},DRI_REPORTS:{path:'/ws/v2/RelatorioBSv2',action:'listarRelatorio'},DRI_RESULTS:{path:'/ws/v2/ResultadoRelatorioBSv2',action:'listarResultadoRelatorio'}} as const;
export type DriKind=keyof typeof DRI_SERVICES;
export type DriSelection={kind:DriKind;month:string;eventCode?:string;reportId?:string;frameId?:string;parentJobId?:string};
export const isDri=(kind:string):kind is DriKind=>Object.prototype.hasOwnProperty.call(DRI_SERVICES,kind);
export function driEnabled(){if(process.env.CCEE_DRI_READ_ENABLED!=='true')throw new ServiceUnavailableException('Consultas DRI desligadas; aguardando homologação.');}
export function driCommand(input:unknown){
 const b=cceeObject(input,['requestId','authorizationId','kind','month'],['parentJobId','eventCode','reportId','frameId']);cceeUuid(b.requestId);cceeUuid(b.authorizationId);cceeMonth(b.month);
 if(!isDri(b.kind))throw new BadRequestException('Escolha uma consulta DRI permitida.');
 const keys=b.kind==='DRI_EVENTS'?[]:b.kind==='DRI_REPORTS'?['parentJobId','eventCode']:['parentJobId','eventCode','reportId','frameId'];
 if(['parentJobId','eventCode','reportId','frameId'].some(k=>keys.includes(k)?typeof b[k]!=='string':b[k]!==undefined)||keys.some(k=>k!=='parentJobId'&&!/^\d{1,20}$/.test(b[k])))throw new BadRequestException('Selecione evento, relatório e quadro nas fontes anteriores.');
 if(b.parentJobId)cceeUuid(b.parentJobId);return b;
}
export function driSoap(config:CceeConfig,s:DriSelection,participant:string,parameters:string[],page:number){
 if(!isDri(s.kind)||!Number.isInteger(page)||page<1||page>10||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(s.month)||!/^\d{1,12}$/.test(participant))throw new CceeReadingError('INVALID_DRI_SELECTION');
 for(const k of ['eventCode','reportId','frameId'] as const)if(s[k]!==undefined&&!/^\d{1,20}$/.test(s[k]!))throw new CceeReadingError('INVALID_DRI_SELECTION');
 if(s.kind!=='DRI_EVENTS'&&!s.eventCode||s.kind==='DRI_RESULTS'&&(!s.reportId||!s.frameId||!parameters.includes('CODIGO_AGENTE')||new Set(parameters).size!==parameters.length||parameters.some(p=>!['CODIGO_AGENTE','CODIGO_EVENTO_CONTABIL'].includes(p))))throw new CceeReadingError('DRI_PARAMETERS_REQUIRE_REVIEW');
 const op=DRI_SERVICES[s.kind].action;let body:string;
 if(s.kind==='DRI_EVENTS')body=`<bm:divulgacaoEventoContabil><bo:eventoContabil><bo:periodoReferencia><bo:mesAno>${s.month}</bo:mesAno></bo:periodoReferencia></bo:eventoContabil></bm:divulgacaoEventoContabil>`;
 else{body=`<bm:eventoContabil><bo:codigo>${s.eventCode}</bo:codigo></bm:eventoContabil>`;
  if(s.kind==='DRI_RESULTS')body+=`<bm:quadro><bo:id>${s.frameId}</bo:id><bo:parametros>${parameters.map(p=>`<bo:parametro><bo:nome>${p}</bo:nome><bo:valor>${xmlEscape(p==='CODIGO_AGENTE'?participant:s.eventCode!)}</bo:valor></bo:parametro>`).join('')}</bo:parametros></bm:quadro><bm:relatorio><bo:id>${s.reportId}</bo:id></bm:relatorio>`;
 }
 return soapRequest(config,'profile',page).replace('<mh:versao>2.1</mh:versao>','').replace('<mh:quantidadeItens>2</mh:quantidadeItens>','<mh:quantidadeItens>1000</mh:quantidadeItens>').replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,`<soapenv:Body><bm:${op}Request>${body}</bm:${op}Request></soapenv:Body>`);
}
const list=(v:any):any[]=>v==null||v===''?[]:Array.isArray(v)?v:[v];
const text=(v:any,max=2000)=>{if(typeof v!=='string'||v.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v))throw new CceeReadingError('DRI_SCHEMA_REQUIRES_REVIEW');return v;};
const id=(v:any)=>{if(typeof v!=='string'||!/^\d{1,20}$/.test(v))throw new CceeReadingError('DRI_SCHEMA_REQUIRES_REVIEW');return v;};
/** The provider uses single-quoted CSV cells. Keep blanks/signs verbatim, never infer money or units. */
export function driCells(line:unknown):string[]{
 const s=text(line,32000),out:string[]=[];let at=0;
 while(at<s.length){if(s[at]!=="'")throw new CceeReadingError('DRI_CSV_REQUIRES_REVIEW');at++;let cell='',closed=false;
  while(at<s.length){if(s[at]==="'"){if(s[at+1]==="'"){cell+="'";at+=2;}else{at++;closed=true;break;}}else cell+=s[at++];}
  if(!closed||cell.length>4000)throw new CceeReadingError('DRI_CSV_REQUIRES_REVIEW');out.push(cell);if(out.length>100)throw new CceeReadingError('DRI_COLUMN_LIMIT');
  if(at===s.length)break;if(s[at++]!==','||at===s.length)throw new CceeReadingError('DRI_CSV_REQUIRES_REVIEW');
 }if(!out.length)throw new CceeReadingError('DRI_CSV_REQUIRES_REVIEW');return out;
}
export function driPage(xml:string,s:DriSelection,page:number,taxId:string){
 const p=privateEnvelope(xml,2,DRI_SERVICES[s.kind].action+'Response',['divulgacaoEventoContabil','relatorio','quadro','parametro','resultadoRelatorio','valor']);
 const pg=p.pagination,number=(x:unknown)=>typeof x==='string'&&/^\d{1,6}$/.test(x)?Number(x):-1;
 const pages=number(pg?.totalPaginas),total=number(pg?.quantidadeTotalItens);
 if(number(pg?.numero)!==page||pages<1||pages>10||total<0||total>10000||page>pages)throw new CceeReadingError('DRI_PAGINATION_LIMIT_OR_MISSING');
 let rows:any[]=[];
 const container=s.kind==='DRI_EVENTS'?'resultadoDivulgacaoEventoContabil':s.kind==='DRI_REPORTS'?'relatorios':'resultados';
 if(!Object.prototype.hasOwnProperty.call(p.body??{},container))throw new CceeReadingError('DRI_SCHEMA_REQUIRES_REVIEW');
 if(s.kind==='DRI_EVENTS')rows=list(p.body?.resultadoDivulgacaoEventoContabil?.divulgacaoEventoContabil).map(x=>{
  const e=x.eventoContabil,code=id(e?.codigo);if(e?.periodoReferencia?.mesAno!==s.month)throw new CceeReadingError('DRI_PERIOD_MISMATCH');return{code,name:text(e.nome),month:s.month};
 });
 else if(s.kind==='DRI_REPORTS')rows=list(p.body?.relatorios?.relatorio).map(r=>{
  const start=text(r.periodo?.inicio),end=text(r.periodo?.fim),frames=list(r.quadros?.quadro).map(f=>({id:id(f.id),name:text(f.nome),description:text(f.descricao??''),parameters:list(f.parametros?.parametro).map(x=>text(x.nome,80))}));
  if(!/^20\d{2}-\d{2}-\d{2}T/.test(start)||!/^20\d{2}-\d{2}-\d{2}T/.test(end)||!Number.isFinite(Date.parse(start))||!Number.isFinite(Date.parse(end))||Date.parse(end)<Date.parse(start)||frames.length>100||new Set(frames.map(f=>f.id)).size!==frames.length||frames.some(f=>f.parameters.length>20||new Set(f.parameters).size!==f.parameters.length))throw new CceeReadingError('DRI_CATALOG_REQUIRES_REVIEW');
  return{id:id(r.id),name:text(r.nome),description:text(r.descricao??''),period:{start,end},frames};
 });
 else for(const r of list(p.body?.resultados?.resultadoRelatorio)){
  if(id(r.relatorio?.id)!==s.reportId||list(r.relatorio?.quadros?.quadro).length!==1||id(list(r.relatorio?.quadros?.quadro)[0]?.id)!==s.frameId)throw new CceeReadingError('DRI_REPORT_MISMATCH');
  const columns=driCells(r.cabecalho),taxColumns=columns.map((x,i)=>({x:x.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),i})).filter(x=>x.x==='CNPJ DO AGENTE');
  if(taxColumns.length!==1||!/^\d{14}$/.test(taxId))throw new CceeReadingError('DRI_PARTICIPANT_PROOF_REQUIRED');
  for(const value of list(r.valores?.valor)){const cells=driCells(value);if(cells.length!==columns.length||!/^\d{14}$|^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/.test(cells[taxColumns[0].i])||cells[taxColumns[0].i].replace(/\D/g,'')!==taxId)throw new CceeReadingError('DRI_PARTICIPANT_MISMATCH');rows.push({columns,cells,reportId:s.reportId,frameId:s.frameId,scope:'PARTICIPANT',financialState:'UNMAPPED_REVIEW_REQUIRED'});}
 }
 if(rows.length>1000||rows.length>total)throw new CceeReadingError('DRI_ROW_LIMIT');
 if(new Set(rows.map(r=>r.code??r.id??JSON.stringify(r))).size!==rows.length)throw new CceeReadingError('DRI_DUPLICATE_ROW');
 return{rows,pages,total,hash:p.hash,transactionId:p.transactionId};
}
export function driDigest(hashes:string[]){return createHash('sha256').update(hashes.join(':')).digest('hex');}

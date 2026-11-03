import {soapRequest,CceeConfig} from './ccee-config';
import {privateEnvelope,CceeReadingError} from './ccee-private.connector';
import {validTaxId} from '../../common/validation/tax-id';
const list=(v:any):any[]=>v==null||v===''?[]:Array.isArray(v)?v:[v];
export function participantRequest(config:CceeConfig,taxId:string,page:number){
 if(!/^\d{14}$/.test(taxId)||!validTaxId(taxId)||!Number.isInteger(page)||page<1||page>10)throw new CceeReadingError('INVALID_CUSTOMER_CNPJ');
 return soapRequest(config,'profile',page).replace('<mh:quantidadeItens>2</mh:quantidadeItens>','<mh:quantidadeItens>10</mh:quantidadeItens>').replace(/<soapenv:Body>[\s\S]*?<\/soapenv:Body>/,`<soapenv:Body><bm:listarParticipanteMercadoRequest><bm:identificacoes><bo:identificacao><bo:numero>${taxId}</bo:numero></bo:identificacao></bm:identificacoes></bm:listarParticipanteMercadoRequest></soapenv:Body>`);
}
export function participantPage(xml:string,taxId:string,page:number){
 const p=privateEnvelope(xml,2,'listarParticipanteMercadoResponse',['participanteMercado','identificacao']);
 const pg=p.pagination,pages=Number(pg?.totalPaginas),total=Number(pg?.quantidadeTotalItens);
 if(Number(pg?.numero)!==page||!Number.isInteger(pages)||pages<1||pages>10||!Number.isInteger(total)||total<0||total>100||page>pages)throw new CceeReadingError('CUSTOMER_PAGINATION_INVALID');
 const rows=list(p.body?.participantesMercado?.participanteMercado).map(r=>{
  const ids=list(r?.parte?.pessoaJuridica?.identificacoes?.identificacao).filter(i=>i?.tipo?.codigo==='CNPJ');
  if(ids.length!==1||ids[0].numero!==taxId||typeof r.codigo!=='string'||!/^\d{1,12}$/.test(r.codigo))throw new CceeReadingError('CUSTOMER_CNPJ_MISMATCH');
  const from=r.periodoVigencia?.inicio,to=r.periodoVigencia?.fim;
  if(typeof from!=='string'||!Number.isFinite(Date.parse(from))||to!=null&&to!==''&&(typeof to!=='string'||!Number.isFinite(Date.parse(to))))throw new CceeReadingError('CUSTOMER_VIGENCY_MISSING');
  if(typeof r.situacao?.codigo!=='string'||typeof r.situacao?.descricao!=='string')throw new CceeReadingError('CUSTOMER_STATUS_MISSING');
  return{agentCode:r.codigo,taxId,validFrom:from,validTo:to||null,statusCode:r.situacao.codigo,status:r.situacao.descricao.slice(0,160)};
 });
 if(rows.length>10)throw new CceeReadingError('CUSTOMER_PAGE_LIMIT');
 return{...p,rows,pages,total};
}
export function participantConclusion(rows:ReturnType<typeof participantPage>['rows'],asOf:string){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf)||!Number.isFinite(Date.parse(asOf)))throw new CceeReadingError('CUSTOMER_REFERENCE_INVALID');
 if(new Set(rows.map(r=>r.agentCode+'|'+r.validFrom+'|'+r.validTo)).size!==rows.length)throw new CceeReadingError('CUSTOMER_DUPLICATE_ROW');
 const current=rows.filter(r=>r.validFrom.slice(0,10)<=asOf&&(!r.validTo||r.validTo.slice(0,10)>=asOf));
 if(!rows.length)return{state:'NOT_FOUND',reason:'CNPJ não localizado no escopo e período consultados. Confira o cadastro e a representação na CCEE; isso não comprova inexistência global.'};
 if(current.length!==1)return{state:current.length?'AMBIGUOUS':'NOT_CURRENT',reason:current.length?'Mais de um participante vigente para o CNPJ; confira perfis e unidades.':'Participante recebido sem vigência atual; confira o período e o cadastro CCEE.'};
 if(current[0].statusCode!=='4282')return{state:'NOT_ADHERED',reason:'Situação CCEE diferente de Aderido. Confira a situação cadastral antes de liberar serviços privados.'};
 return{state:'REPRESENTATION_PENDING',reason:'CNPJ e participante identificados. Confira representação, perfil, ponto e escopo de cada unidade antes de autorizar coletas privadas.',participant:current[0]};
}

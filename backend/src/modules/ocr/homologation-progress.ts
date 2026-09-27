type Review={id:string;sourceHash:string;decision:string;author:string;createdAt:string;version:number};
type Field={key:string;label:string;sourceHash:string;state:string;decimal:string|null;history:Review[]};
const identityKeys=['customer','taxId','unit','address','period','market'];
const consumptionKeys=['consumptionPeakKwh','consumptionOffPeakKwh','consumptionTotalKwh'];
const labels:Record<string,string>={customer:'Razão social',taxId:'CNPJ',unit:'Unidade consumidora',address:'Endereço',period:'Competência',market:'Ambiente de contratação',consumptionPeakKwh:'Consumo na ponta',consumptionOffPeakKwh:'Consumo fora ponta',consumptionTotalKwh:'Consumo total'};
function group(key:string,title:string,fields:Field[],required:string[],accepted:string[],extracted:string){
 const keys=required.length?required:[...new Set(fields.map(f=>f.key))];
 const rows=keys.map(k=>{
  const matches=fields.filter(f=>f.key===k),f=matches.length===1?matches[0]:null;
  const history=f?[...f.history].sort((a,b)=>b.version-a.version):[],latest=history[0];
  let state='PENDING';
  if(!f||f.state!==extracted||!f.sourceHash||f.decimal===null)state='BLOCKED';
  else if(latest&&latest.sourceHash!==f.sourceHash)state='STALE';
  else if(latest?.decision==='NEEDS_CORRECTION')state='NEEDS_CORRECTION';
  else if(latest&&accepted.includes(latest.decision)&&history.filter(r=>r.version===latest.version).length===1)state='CONFIRMED';
  return {key:k,label:f?.label??labels[k]??k,state,review:latest?{id:latest.id,version:latest.version,author:latest.author,createdAt:latest.createdAt,decision:latest.decision}:null};
 });
 const confirmed=rows.filter(r=>r.state==='CONFIRMED').length;
 return {key,title,confirmed,total:rows.length,complete:rows.length>0&&confirmed===rows.length,rows};
}
/** Read-only progress. Human review completion never grants financial import or approval. */
export function homologationProgress(identity:Field[],consumption:Field[],demand:Field[]){
 const groups=[group('identity','Identidade e competência',identity,identityKeys,['CONFIRMED'],'EXTRACTED_REVIEW'),group('consumption','Consumo',consumption,consumptionKeys,['CONFIRMED'],'EXTRACTED_REVIEW'),group('demand','Parcelas de demanda faturada',demand,[],['USED','UNUSED'],'BILLED_UNCLASSIFIED')];
 return {canImport:false as const,homologated:false as const,checkedAt:new Date().toISOString(),state:groups.every(g=>g.complete)?'REVIEWS_COMPLETE':'REVIEWS_PENDING',groups,
 integration:[{key:'monthly',title:'Dados mensais',state:'PENDING',message:'Consumo conferido ainda não foi integrado por este fluxo. Demanda faturada não substitui a medição de demanda.'},{key:'parameters',title:'Parâmetros de cálculo',state:'PENDING',message:'Conferir vigência, tarifas, postos e incidência tributária antes de integrar.'},{key:'costs',title:'Custos mensais',state:'PENDING',message:'Reconciliar componentes e tributos com o total da distribuidora, sem duplicar a energia ACL do fornecedor.'},{key:'preparation',title:'Preparar apuração',state:'BLOCKED',message:'A liberação depende da integração validada de medições, parâmetros e custos. As conferências não aprovam o cálculo.'}],
 message:'Este painel mostra as conferências da evidência atual. Concluir as conferências não equivale a homologar a fatura nem importar dados. Lançamentos manuais existentes não são alterados ou avaliados aqui.'};
}

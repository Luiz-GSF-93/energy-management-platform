import {BadRequestException} from '@nestjs/common';
import {contractSupplierCost} from '../contracts/services/contract-supplier-cost';
import {indexMemoryParameters,indexMemoryPlan,indexMemoryHash,parseOfficialIpca,calculateIndexMemory} from '../contracts/services/contract-index-memory.model';
const scale=10n**12n;
const decimal=(v:string)=>{if(!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(v))throw Error('Preço ou quantidade sem fonte.');const [a,b='']=v.split('.');return BigInt(a)*scale+BigInt(b.padEnd(12,'0'));};
const quantity=(v:bigint)=>{const s=(v<0n?-v:v).toString().padStart(13,'0');return (v<0n?'-':'')+s.slice(0,-12)+'.'+s.slice(-12);};

export const COMPARISON_VERSION='CONTRACT_PLD_COMPARISON_1';
export function comparisonQuery(input:any){
 const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i,month=/^20\d{2}-(0[1-9]|1[0-2])$/;
 if(!input||Array.isArray(input)||Object.keys(input).some(k=>!['from','to','selection'].includes(k))||!month.test(input.from)||!month.test(input.to)||input.from>input.to||!Array.isArray(input.selection)||!input.selection.length||input.selection.length>20||input.selection.some((s:any)=>!s||Object.keys(s).sort().join(',')!=='customerId,unitId'||!uuid.test(s.customerId)||!uuid.test(s.unitId))||new Set(input.selection.map((s:any)=>s.unitId)).size!==input.selection.length)throw new BadRequestException('Selecione empresas e até 20 unidades, com período válido.');
 const months:string[]=[];for(let at=input.from;at<=input.to;){months.push(at);if(months.length>24)throw new BadRequestException('Consulte até 24 meses.');const date=new Date(at+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()+1);at=date.toISOString().slice(0,7);}
 return {from:input.from as string,to:input.to as string,selection:input.selection as {customerId:string;unitId:string}[],months};
}
const day=(v:any)=>String(v??'').slice(0,10);
const numeric=(v:any)=>/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(String(v));
export function nominalDifference(price:string|null,reference:string|null){
 if(price===null||reference===null)return {difference:null,percent:null};
 const p=decimal(price),r=decimal(reference),d=p-r;
 return {difference:quantity(d),percent:r>0n?quantity(d*100n*scale/r):null};
}
/** Revalidate the completed memory, including its evidence; no network, invoice
 * substitution, or financial application of a proposed price. */
function rememberedPrice(contract:any,month:string,memories:any[],documents:any[],base:any){
 const latest=new Map<string,any>();for(const m of memories.filter(m=>m.contract_id===contract.id)){const key=m.parameters?.month;if(!latest.has(key)||m.version>latest.get(key).version)latest.set(key,m);}
 const eligible=[...latest.values()].filter(m=>{try{return indexMemoryHash(indexMemoryPlan({...m.parameters,month}))===indexMemoryHash(m.plan);}catch{return false;}}).sort((a,b)=>b.version-a.version);
 const m=latest.get(month)??eligible[0];if(!m||m.state!=='COMPLETE')return null;
 try{
  const p=indexMemoryParameters(m.parameters),plan=indexMemoryPlan(p),doc=documents.find(d=>d.id===m.source_document?.id),e=m.result?.evidence;
  if(m.organization_id!==contract.organization_id||m.customer_id!==contract.customer_id||m.consumer_unit_id!==contract.consumer_unit_id||indexMemoryHash(m.contract_snapshot)!==indexMemoryHash(contract)||!doc||doc.organization_id!==contract.organization_id||doc.customer_id!==contract.customer_id||doc.consumer_unit_id!==contract.consumer_unit_id||doc.energy_contract_id!==contract.id||!doc.file_verified||doc.file_hash!==m.source_document.fileHash||p.sourceDocumentId!==doc.id||!numeric(base)||decimal(String(base))!==decimal(p.basePrice)||!m.created_by||!m.consent_note?.trim()||![m.created_at,m.consent_at,m.expires_at,m.finished_at].every(v=>typeof v==='string'&&Number.isFinite(Date.parse(v)))||Date.parse(m.consent_at)<Date.parse(m.created_at)||Date.parse(m.consent_at)>Date.parse(m.expires_at)||Date.parse(m.finished_at)<Date.parse(m.consent_at)||indexMemoryHash(plan)!==indexMemoryHash(m.plan)||indexMemoryHash(indexMemoryPlan({...p,month}))!==indexMemoryHash(plan))return null;
  let indices:Record<string,string>={};if(plan.due){if(!e||e.url!==plan.url||indexMemoryHash(e.data)!==e.sha256||!Number.isFinite(Date.parse(e.retrievedAt))||Date.parse(e.retrievedAt)<Date.parse(m.consent_at)-60000||Date.parse(e.retrievedAt)>Date.parse(m.finished_at))return null;indices=parseOfficialIpca(e.data,plan);}
  const calculated=calculateIndexMemory(p,indices,contract.current_price);if(indexMemoryHash(calculated)!==indexMemoryHash(m.result?.calculation)||m.result?.financialApplication!==false)return null;
  return {value:calculated.pricePerMwh,source:`Memória ${m.id} · revisão ${m.version} · ${doc.original_filename}`,memoryId:m.id,documentId:doc.id,documentHash:doc.file_hash,basePrice:p.basePrice,index:p.index,baseDate:p.baseDate,factor:calculated.factor};
 }catch{return null;}
}
export function unitContractComparison(unit:any,month:string,sources:any,prices:any[],memories:any[],documents:any[],market:any[]){
 const coverage=sources.coverage.find((r:any)=>r.month===month),last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10);
 // Price research does not require proving flexibility. A scoped active
 // contract with a final price may still be shown with no weighted volume.
 // Published/pending interruption and spot declarations always take priority.
 const candidates=sources.contracts.filter((c:any)=>c.organization_id===unit.organization_id&&c.customer_id===unit.customer_id&&c.consumer_unit_id===unit.id&&c.contract_type==='ENERGY_PURCHASE'&&['ACTIVE','APPROVED'].includes(c.status)&&day(c.start_date)<=month+'-01'&&day(c.end_date)>=last);
 const purePrice=coverage?.status==='NO_REGULAR_COVERAGE'&&Array.isArray(sources.terms)&&!sources.terms.some((t:any)=>t.from<=last&&t.to>=month+'-01'&&['SPOT','INTERRUPTED'].includes(t.mode));
 const spot=coverage?.status==='SPOT_PURCHASE',contract=sources.contracts.find((c:any)=>c.id===coverage?.contractId)??((purePrice||spot)&&candidates.length===1?candidates[0]:null);
 const row:any={customerId:unit.customer_id,unitId:unit.id,month,state:spot?'SPOT':coverage?.status==='NO_REGULAR_COVERAGE'?'NO_REGULAR_CONTRACT':'SOURCE_PENDING',contractId:null,contractNumber:null,submarket:null,price:null,spotPrice:null,volumeMwh:null,taxBasis:'UNKNOWN',source:null,adjustment:null,pld:null,pldOrigin:null,pldHours:null,scenarios:[],notice:'TE contratada ainda sem fonte vigente e única. Preço faturado não substitui o preço do contrato.'};
 if(unit.free_market!==true){row.state='SOURCE_PENDING';row.notice='Unidade sem enquadramento ACL confirmado; não atribuir TE de Mercado Livre a este cadastro.';return row;}
 if(!contract||!purePrice&&!spot&&!['WITHIN_LIMIT','BELOW_MINIMUM','AT_LIMIT','PROJECTED_EXCESS'].includes(coverage.status)){if(row.state==='SPOT'||row.state==='NO_REGULAR_CONTRACT')row.notice='Sem contrato regular vigente comprovado nesta competência; compras avulsas não prolongam a TE do contrato interrompido.';return row;}
 row.contractId=contract.id;row.contractNumber=contract.contract_number;row.submarket=contract.submarket;row.volumeMwh=coverage.baseMwh??null;
 const result=contractSupplierCost(unit,month,sources.contracts,prices,sources.rules,[],[]);
 const rules=sources.rules.filter((r:any)=>r.contract_id===contract.id&&day(r.start_date)<=month+'-31'&&day(r.end_date)>=month+'-01').sort((a:any,b:any)=>b.version-a.version),rule=rules[0];
 // The shared engine has already validated price periods, FINAL/BASE and the
 // registered accumulated index. Measurement incompleteness is irrelevant here.
 if(spot&&result.contract?.id===contract.id&&result.formulaVersion==='spot-supplier-1.0'&&numeric(result.pricePerMwh)){row.spotPrice=quantity(decimal(result.pricePerMwh));row.source={contractId:contract.id,price:'Preço final da compra avulsa registrada · '+result.priceSource,rule:result.rule,from:day(contract.start_date),to:day(contract.end_date)};row.taxBasis=result.taxTreatment??'UNKNOWN';row.notice='Compra avulsa: preço próprio registrado para esta competência, apresentado em série separada. Não representa TE ou flexibilidade de contrato regular.';}
 else if(!spot&&result.contract?.id===contract.id&&numeric(result.pricePerMwh)&&rule?.volume_basis!=='SPOT'){row.price=quantity(decimal(result.pricePerMwh));row.source={contractId:contract.id,price:result.priceSource,rule:result.rule,from:day(contract.start_date),to:day(contract.end_date)};row.taxBasis=result.taxTreatment??'UNKNOWN';}
 else if(!spot){
  const last=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),0)).toISOString().slice(0,10),annual=(contract.annual_prices??[]).filter((p:any)=>p.startDate<=month+'-01'&&p.endDate>=last),history=prices.filter(p=>p.contract_id===contract.id&&day(p.start_date)<=last&&day(p.end_date)>=month+'-01');
  const final=history.length===1&&!annual.length&&day(history[0].start_date)<=month+'-01'&&day(history[0].end_date)>=last?{value:history[0].price_per_mwh,source:'Histórico contratual '+history[0].id}:!history.length&&annual.length===1&&annual[0].priceStatus==='FINAL'?{value:annual[0].pricePerMwh,source:'Tabela contratual por vigência'}:!history.length&&!(contract.annual_prices??[]).length&&contract.pricing_mode==='FIXED'?{value:contract.current_price,source:'Preço fixo do contrato'}:null;
  if(final&&numeric(final.value)&&rule?.volume_basis!=='SPOT'){row.price=quantity(decimal(String(final.value)));row.source={contractId:contract.id,price:final.source,from:day(contract.start_date),to:day(contract.end_date)};}
  const base=annual.length===1&&annual[0].priceStatus==='BASE'&&!history.length?annual[0].pricePerMwh:!(contract.annual_prices??[]).length&&!history.length&&contract.pricing_mode==='INDEXED'?contract.current_price:null;
  const memory=base!==null?rememberedPrice(contract,month,memories,documents,base):null;
  if(memory){row.price=memory.value;row.adjustment=memory;row.source={contractId:contract.id,price:memory.source,from:day(contract.start_date),to:day(contract.end_date)};if(rule?.start_date<=month+'-01'&&day(rule?.end_date)>=last)row.taxBasis=rule.tax_treatment;}
 }
 const pld=market.filter(p=>p.at.slice(0,7)===month&&p.submarket===row.submarket);if(pld.length===1){row.pld=pld[0].value;row.pldOrigin=pld[0].origin;row.pldHours=pld[0].hours;row.pldSource={source:pld[0].source,hash:pld[0].hash};}
 row.scenarios=[{key:'PLD',multiplier:100},{key:'PLD_PLUS_5',multiplier:105},{key:'PLD_PLUS_10',multiplier:110},{key:'PLD_PLUS_15',multiplier:115}].map(s=>{const reference=row.pld===null?null:quantity(decimal(row.pld)*BigInt(s.multiplier)/100n);return {key:s.key,value:reference,...nominalDifference(row.price??row.spotPrice,reference)};});
 if(row.price!==null){row.state='AVAILABLE';row.notice='Correlação nominal de preços contratuais e mercado; não representa economia realizada. Confira tributos, perdas, vigência e condições. '+(row.pldOrigin==='SOAP'?'PLD médio somente das horas coletadas; competência parcial.':row.pld!==null?'PLD de referência mensal publicada.':'Sem PLD disponível para esta competência/submercado.');}
 return row;
}
export function weightedComparison(rows:any[],expected:number){
 const good=rows.filter(r=>r.price!==null&&r.volumeMwh!==null&&decimal(r.volumeMwh)>0n),volume:bigint=good.reduce((s:bigint,r:any)=>s+decimal(r.volumeMwh),0n);
 if(good.length!==expected||!volume||new Set(good.map(r=>r.taxBasis)).size!==1||good.some(r=>!['NET','GROSS'].includes(r.taxBasis)))return {price:null,pld:null,covered:good.length,total:expected,notice:'Consolidado requer preço, volume e base fiscal homogênea de todas as unidades selecionadas.'};
 const weighted=(key:string)=>good.every(r=>r[key]!==null)?quantity(good.reduce((sum:bigint,r:any)=>sum+decimal(r[key])*decimal(r.volumeMwh),0n)/volume):null;
 return {price:weighted('price'),pld:weighted('pld'),covered:good.length,total:expected,volumeMwh:quantity(volume),taxBasis:good[0].taxBasis,notice:'Média ponderada pelo volume contratual mensal. Comparação nominal; não é custo liquidado.'};
}

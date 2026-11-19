import {BadRequestException} from '@nestjs/common';
export type SupplyPeriod={year:number;startDate:string;endDate:string;months:number};
export const guaranteeTypes:Record<string,string>={NONE:'Sem exigência de garantia',LETTER_GUARANTEE:'Carta fiança',SURETY_INSURANCE:'Seguro garantia',CASH_COLLATERAL:'Caução',OTHER:'Outro'};
export const billingMethods:Record<string,string>={BOLETO:'Boleto',TRANSFER:'Transferência eletrônica',OTHER:'Outro'};
const bad=(message:string):never=>{throw new BadRequestException(message);};
const record=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v);
const numeric=(v:any,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const string=(v:any,max:number,required=true)=>{if(typeof v!=='string'||v.trim().length>max||required&&!v.trim())bad('Confira os textos e as condições da proposta.');return v.trim();};
export function supplyDate(v:unknown):v is string{return typeof v==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;}
export function calendarSupplyPeriods(start:string,end:string):SupplyPeriod[]{
 if(!supplyDate(start)||!supplyDate(end)||end<start)bad('Informe datas inicial e final válidas para o fornecimento.');
 const months=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;
 if(months>600)bad('O fornecimento deve ter no máximo 600 meses.');
 return Array.from({length:Number(end.slice(0,4))-Number(start.slice(0,4))+1},(_,i)=>{const year=Number(start.slice(0,4))+i,startDate=year===Number(start.slice(0,4))?start:`${year}-01-01`,endDate=year===Number(end.slice(0,4))?end:`${year}-12-31`;return {year,startDate,endDate,months:Number(endDate.slice(5,7))-Number(startDate.slice(5,7))+1};});
}
export function supplyReferences(value:any,periods:SupplyPeriod[],required=false){
 if(!Array.isArray(value)||value.length>51)bad('Confira as referências por ano.');const seen=new Set<number>();
 const rows=value.map((r:any)=>{if(!record(r)||Object.keys(r).sort().join(',')!=='priceBrlMwh,year'||!periods.some(p=>p.year===r.year)||seen.has(r.year)||!numeric(r.priceBrlMwh,0.0001,1e7))bad('Informe uma referência positiva por ano da vigência, sem repetir anos.');seen.add(r.year);return {year:r.year,priceBrlMwh:r.priceBrlMwh};}).sort((a:any,b:any)=>a.year-b.year);
 if(required&&rows.length!==periods.length)bad('Cadastre a referência de preço de cada ano antes de enviar a cotação.');return rows;
}
export function normalizeSupplyScope(d:any){
 if(d.supplyVersion!==3)bad('Versão do fornecimento inválida.');
 const periods=calendarSupplyPeriods(d.supplyStartDate,d.supplyEndDate);
 if(!Array.isArray(d.unitIds)||!d.unitIds.length||d.unitIds.length>50||new Set(d.unitIds).size!==d.unitIds.length||d.unitIds.some((id:any)=>typeof id!=='string'||!id||id.length>200)||typeof d.discloseUnitCnpj!=='boolean')bad('Selecione de 1 a 50 unidades e indique se deseja informar o CNPJ.');
 if(d.unitIds.length*periods.length>500)bad('Reduza esta cotação para no máximo 500 combinações de unidade e ano.');
 if(d.discloseUnitCnpj){if(!Array.isArray(d.unitCnpjs)||d.unitCnpjs.length!==d.unitIds.length||new Set(d.unitCnpjs.map((r:any)=>r?.unitId)).size!==d.unitIds.length||d.unitCnpjs.some((r:any)=>!record(r)||Object.keys(r).sort().join(',')!=='cnpj,unitId'||!d.unitIds.includes(r.unitId)||typeof r.cnpj!=='string'))bad('Informe o CNPJ de cada unidade selecionada.');d.unitCnpjs=d.unitCnpjs.map((r:any)=>({unitId:r.unitId,cnpj:r.cnpj.replace(/\D/g,'')}));}else d.unitCnpjs=[];
 d.unitId=d.unitIds[0];d.startMonth=d.supplyStartDate.slice(0,7);d.months=periods.reduce((sum,p)=>sum+p.months,0);d.supplyPeriods=periods;
 d.annualReferencePrices=supplyReferences(d.annualReferencePrices??[],periods);return d;
}
const offerKeys=['unitId','periodPrices','flexibilityUpperPercent','flexibilityLowerPercent','seasonality','correctionIndex','modulation','guaranteeType','guaranteeOther','billingBusinessDaysAfterInvoice','billingMethod','billingMethodOther','commercialNotes'];
export function normalizeUnitOffers(value:any){
 if(!Array.isArray(value)||!value.length||value.length>50)bad('Preencha as condições e preços das unidades solicitadas.');const seen=new Set<string>();
 return value.map((v:any)=>{
  if(!record(v)||Object.keys(v).some(k=>!offerKeys.includes(k))||typeof v.unitId!=='string'||!v.unitId||v.unitId.length>200||seen.has(v.unitId))bad('Unidade inválida ou repetida na proposta.');seen.add(v.unitId);
  if(!numeric(v.flexibilityUpperPercent,0,1000)||!numeric(v.flexibilityLowerPercent,-100,0)||!Number.isInteger(v.billingBusinessDaysAfterInvoice)||!numeric(v.billingBusinessDaysAfterInvoice,0,365)||!Object.prototype.hasOwnProperty.call(guaranteeTypes,v.guaranteeType)||!Object.prototype.hasOwnProperty.call(billingMethods,v.billingMethod))bad('Confira flexibilidade, garantia, dias úteis e modalidade de cobrança de cada unidade.');
  const guaranteeOther=string(v.guaranteeOther??'',1000,v.guaranteeType==='OTHER'),billingMethodOther=string(v.billingMethodOther??'',1000,v.billingMethod==='OTHER');
  if(!Array.isArray(v.periodPrices)||!v.periodPrices.length||v.periodPrices.length>51)bad('Preencha um preço por período anual.');const years=new Set<number>();
  const periodPrices=v.periodPrices.map((r:any)=>{if(!record(r)||Object.keys(r).sort().join(',')!=='priceBrlMwh,year'||!Number.isInteger(r.year)||r.year<2000||r.year>2099||years.has(r.year)||!numeric(r.priceBrlMwh,0.0001,1e7))bad('Preço ou ano inválido ou repetido na unidade.');years.add(r.year);return {year:r.year,priceBrlMwh:r.priceBrlMwh};}).sort((a:any,b:any)=>a.year-b.year);
  const billingTerms=`${v.billingBusinessDaysAfterInvoice} DU após emissão da NF`,guarantees=v.guaranteeType==='OTHER'?`Outro: ${guaranteeOther}`:guaranteeTypes[v.guaranteeType],commercialNotes=string(v.commercialNotes??'',4000,false);
  return {unitId:v.unitId,periodPrices,commercialTermsVersion:2,flexibilityUpperPercent:v.flexibilityUpperPercent,flexibilityLowerPercent:v.flexibilityLowerPercent,flexibility:`+${v.flexibilityUpperPercent}% / ${v.flexibilityLowerPercent}%`,seasonality:string(v.seasonality,1000),correctionIndex:string(v.correctionIndex,1000),modulation:string(v.modulation,1000),guaranteeType:v.guaranteeType,guaranteeOther,guarantees,billingBusinessDaysAfterInvoice:v.billingBusinessDaysAfterInvoice,billingMethod:v.billingMethod,billingMethodOther,billingTerms,commercialNotes,conditions:`${billingTerms}. Modalidade de cobrança: ${v.billingMethod==='OTHER'?billingMethodOther:billingMethods[v.billingMethod]}.${commercialNotes?' '+commercialNotes:''}`};
 });
}
export function proposalDeadline(d:any){
 const v=d?.validUntil;if(typeof v!=='string')return NaN;
 if(/^\d{4}-\d{2}-\d{2}$/.test(v)){if(!supplyDate(v))return NaN;return Date.parse(v+'T23:59:59.999-03:00');}
 return supplyDate(v.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.test(v)?Date.parse(v):NaN;
}
export function proposalIsLive(d:any,now=Date.now()){const time=proposalDeadline(d);return Number.isFinite(time)&&time>now;}
export function normalizeProposalSupply(d:any){
 if(d.proposalVersion!==3)bad('Versão da proposta inválida.');if(Buffer.byteLength(JSON.stringify(d),'utf8')>90000)bad('Proposta extensa: resuma os comentários e anexe os detalhes em PDF.');d.unitOffers=normalizeUnitOffers(d.unitOffers);
 if(!Number.isFinite(proposalDeadline(d))||!d.validUntil.includes('T')||!proposalIsLive(d))bad('Informe data e horário futuros para a validade da proposta, no horário de Brasília.');
 Object.assign(d,legacyOfferFields(d.unitOffers[0]));return d;
}
function legacyOfferFields(offer:any,periods?:SupplyPeriod[]){const weighted=periods?periods.reduce((sum,p)=>sum+p.months*offer.periodPrices.find((r:any)=>r.year===p.year).priceBrlMwh,0)/periods.reduce((sum,p)=>sum+p.months,0):offer.periodPrices[0].priceBrlMwh;const {unitId,periodPrices,...fields}=offer;return {...fields,priceBrlMwh:Number(weighted.toFixed(6))};}
export function bindProposalSupply(d:any,o:any){
 if(o.supplyVersion!==3){if(d.proposalVersion===3)bad('Esta cotação utiliza o formulário anterior.');return d;}
 if(d.proposalVersion!==3||!Array.isArray(d.unitOffers)||d.unitOffers.length!==o.unitIds.length)bad('Preencha uma oferta para cada unidade desta cotação.');
 const periods=calendarSupplyPeriods(o.supplyStartDate,o.supplyEndDate),units=o.unitIds.map((id:string)=>d.unitOffers.find((u:any)=>u.unitId===id));
 if(units.some((u:any)=>!u||u.periodPrices.length!==periods.length||periods.some(p=>!u.periodPrices.some((r:any)=>r.year===p.year))))bad('Preencha todos os períodos anuais de cada unidade, sem incluir unidades ou anos de outra cotação.');
 d.unitOffers=units.map((u:any)=>({...u,unitName:o.unitSnapshots?.find((v:any)=>v.id===u.unitId)?.name??'Unidade'}));Object.assign(d,legacyOfferFields(units[0],periods));return d;
}
export function supplyPriceRows(d:any,o:any){
 if(d.proposalVersion!==3||o.supplyVersion!==3)return [];
 return (d.unitOffers??[]).flatMap((u:any)=>(o.supplyPeriods??[]).flatMap((period:any)=>{const price=u.periodPrices?.find((p:any)=>p.year===period.year)?.priceBrlMwh;return typeof price==='number'&&price>0?[{...period,unitId:u.unitId,unitName:o.unitSnapshots?.find((s:any)=>s.id===u.unitId)?.name??'Unidade',priceBrlMwh:price,terms:u,scopeKey:u.unitId+':'+period.year}]:[];}));
}

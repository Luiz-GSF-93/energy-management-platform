export type SupplyPeriod={year:number;startDate:string;endDate:string;months:number};
export const guaranteeOptions=[['NONE','Sem exigência de garantia'],['LETTER_GUARANTEE','Carta fiança'],['SURETY_INSURANCE','Seguro garantia'],['CASH_COLLATERAL','Caução'],['OTHER','Outro']] as const;
export const billingOptions=[['BOLETO','Boleto'],['TRANSFER','Transferência eletrônica'],['OTHER','Outro']] as const;
const realDate=(v:string)=>/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
export function calendarPeriods(start:string,end:string):SupplyPeriod[]{
 if(!realDate(start)||!realDate(end)||end<start)return [];
 const months=(Number(end.slice(0,4))-Number(start.slice(0,4)))*12+Number(end.slice(5,7))-Number(start.slice(5,7))+1;if(months>600)return [];
 return Array.from({length:Number(end.slice(0,4))-Number(start.slice(0,4))+1},(_,i)=>{const year=Number(start.slice(0,4))+i,startDate=year===Number(start.slice(0,4))?start:`${year}-01-01`,endDate=year===Number(end.slice(0,4))?end:`${year}-12-31`;return {year,startDate,endDate,months:Number(endDate.slice(5,7))-Number(startDate.slice(5,7))+1};});
}
export function brasiliaLocal(value:string){
 if(!Number.isFinite(Date.parse(value)))return '';
 const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value)).map(p=>[p.type,p.value]));
 return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function brasiliaIso(value:string){
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)||!realDate(value.slice(0,10)))throw Error('Informe data e horário válidos no horário de Brasília.');
 const target=Date.parse(value+'Z');if(!Number.isFinite(target))throw Error('Data e horário inválidos.');let candidate=target;
 for(let i=0;i<3;i++){const represented=Date.parse(brasiliaLocal(new Date(candidate).toISOString())+'Z');candidate+=target-represented;}
 if(brasiliaLocal(new Date(candidate).toISOString())!==value)throw Error('Horário indisponível em Brasília.');return new Date(candidate).toISOString();
}
export const dateLabel=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)?s.slice(8)+'/'+s.slice(5,7)+'/'+s.slice(0,4):s;
export const validityLabel=(s:string)=>s?.includes('T')?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'}).format(new Date(s))+' · Brasília':dateLabel(s??'');
export function readSupplyScope(f:FormData){
 const unitIds=f.getAll('unitIds').map(String),discloseUnitCnpj=f.get('discloseUnitCnpj')==='true',supplyStartDate=String(f.get('supplyStartDate')??''),supplyEndDate=String(f.get('supplyEndDate')??''),periods=calendarPeriods(supplyStartDate,supplyEndDate);
 if(!periods.length||!unitIds.length)throw Error('Selecione unidades e datas válidas para o fornecimento.');
 const annualReferencePrices=periods.flatMap(p=>{const raw=String(f.get('annualReference_'+p.year)??'').trim();return raw?[{year:p.year,priceBrlMwh:Number(raw.replace(',','.'))}]:[];});
 return {supplyVersion:3,supplyStartDate,supplyEndDate,unitIds,unitId:unitIds[0],discloseUnitCnpj,unitCnpjs:discloseUnitCnpj?unitIds.map(unitId=>({unitId,cnpj:String(f.get('unitCnpj_'+unitId)??'').trim()})):[],annualReferencePrices,startMonth:supplyStartDate.slice(0,7),months:periods.reduce((n,p)=>n+p.months,0)};
}
export function readOfferCommercial(f:FormData,prefix=''){
 const get=(key:string)=>String(f.get(prefix+key)??'').trim();
 const percent=(key:string)=>{const v=get(key);if(!/^[+-]?\d+(?:[.,]\d+)?%?$/.test(v))throw Error('Informe as flexibilidades, por exemplo +40% e -20%.');return Number(v.replace('%','').replace(',','.'));};
 const guaranteeType=get('guaranteeType'),guaranteeOther=get('guaranteeOther'),billingMethod=get('billingMethod'),billingMethodOther=get('billingMethodOther'),days=get('billingBusinessDaysAfterInvoice');
 if(!/^\d{1,3}$/.test(days)||Number(days)>365||!guaranteeOptions.some(([key])=>key===guaranteeType)||!billingOptions.some(([key])=>key===billingMethod)||guaranteeType==='OTHER'&&!guaranteeOther||billingMethod==='OTHER'&&!billingMethodOther)throw Error('Confira garantia, dias úteis após a NF e modalidade de cobrança.');
 return {flexibilityUpperPercent:percent('flexibilityUpperPercent'),flexibilityLowerPercent:percent('flexibilityLowerPercent'),seasonality:get('seasonality'),correctionIndex:get('correctionIndex'),modulation:get('modulation'),guaranteeType,guaranteeOther,billingBusinessDaysAfterInvoice:Number(days),billingMethod,billingMethodOther,commercialNotes:get('commercialNotes')};
}
export function readUnitOffers(f:FormData,opportunity:any){const offers=(opportunity.units??opportunity.unitSnapshots??[]).map((u:any)=>{const prefix='unitOffer_'+u.id+'_';return {unitId:u.id,...readOfferCommercial(f,prefix),periodPrices:(opportunity.supplyPeriods??[]).map((p:any)=>({year:p.year,priceBrlMwh:Number(String(f.get(prefix+'price_'+p.year)??'').replace(',','.'))}))};});if(new TextEncoder().encode(JSON.stringify(offers)).length>75000)throw Error('A proposta está extensa. Resuma os comentários e anexe os detalhes em PDF.');return offers;}
export function readLegacyOffer(f:FormData){const c=readOfferCommercial(f),billingTerms=`${c.billingBusinessDaysAfterInvoice} DU após emissão da NF`;return {commercialTermsVersion:2,flexibilityUpperPercent:c.flexibilityUpperPercent,flexibilityLowerPercent:c.flexibilityLowerPercent,seasonality:c.seasonality,correctionIndex:c.correctionIndex,modulation:c.modulation,guarantees:c.guaranteeType==='OTHER'?`Outro: ${c.guaranteeOther}`:guaranteeOptions.find(([key])=>key===c.guaranteeType)![1],billingTerms,conditions:`${billingTerms}. Modalidade de cobrança: ${c.billingMethod==='OTHER'?c.billingMethodOther:billingOptions.find(([key])=>key===c.billingMethod)![1]}.${c.commercialNotes?' '+c.commercialNotes:''}`};}

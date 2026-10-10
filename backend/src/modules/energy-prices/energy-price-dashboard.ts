import {feeCents,feeMoney} from '../contracts/services/management-fee';
import {reviewDigest} from '../contracts/services/review-snapshots.service';
import {pldSpreadScenarios} from './pld-spread';
import {baselineFromStudy,decimal,quantity,specificPrice,indicativePrice} from './energy-price-score';
export function energyPriceDashboard(org:string,year:number,data:any,portal:boolean){
 if(!Array.isArray(data.units)||!Array.isArray(data.studies)||!Array.isArray(data.baselines)||!Array.isArray(data.financial)||!Array.isArray(data.pld)||portal&&data.studies.length)throw Error('Fontes de preço fora do escopo.');
 const units=data.units as {id:string;name:string;customerId:string;customerName:string}[];
 if(data.customerId&&units.some(u=>u.customerId!==data.customerId))throw Error('Unidade de outro cliente.');
 const published=new Map(data.baselines.map((b:any)=>[b.unitId,b.payload]));
 const baselines=units.map(u=>{const p:any=published.get(u.id);if(p)return {unitId:u.id,published:true,baseline:p,study:null};
 const study=portal?null:data.studies.find((s:any)=>s.unitId===u.id);return {unitId:u.id,published:false,baseline:study?baselineFromStudy(study.body.result):{state:'PENDING',reason:'Referência anual ainda não publicada.'},study:study?{id:study.id,hash:study.hash,version:study.version,reviewed:study.reviewed}:null};});
 const complete=units.length>0&&baselines.every(b=>b.baseline.state==='AVAILABLE');
 let acr:string|null=null,acrNet:string|null=null;
 if(complete){const volume=baselines.reduce((a,b)=>a+decimal(b.baseline.annualKwh),0n);acr=specificPrice(baselines.reduce((a,b)=>a+feeCents(b.baseline.annualGrossTe),0n),volume);if(baselines.every(b=>b.baseline.annualNetTe!==null))acrNet=specificPrice(baselines.reduce((a,b)=>a+feeCents(b.baseline.annualNetTe),0n),volume);}
 const prices=data.financial.map((f:any)=>{
 if(!units.some(u=>u.id===f.unitId))throw Error('Publicação de outra unidade.');
 const p=f.payload;if(!p||reviewDigest(p)!==f.hash||p.sources?.organizationId!==org||p.sources?.customerId!==data.customerId||p.sources?.month!==f.month||p.financial?.status!=='AVAILABLE'||!p.financial.units?.some((u:any)=>u.id===f.unitId))throw Error('Integridade da apuração publicada indisponível.');
 const prep=p.preparations?.[f.unitId],supplier=prep?.contractSupplierCost,composition=prep?.operationalComposition?.scenarios?.find((s:any)=>s.scenario==='ACL');
 const measurements=prep?.measurements?.validatedVersion?.measurements;
 if(!supplier||supplier.status!=='READY'||supplier.month!==f.month||supplier.requirements?.length||!measurements||composition?.status!=='AVAILABLE')return {unitId:f.unitId,month:f.month,gross:null,net:null,kwh:null,reason:'Compra mensal ou consumo publicado incompleto.'};
 const volume=decimal(measurements.consumptionTotal);
 if(volume<=0n||decimal(measurements.consumptionPeak)+decimal(measurements.consumptionOffPeak)!==volume)return {unitId:f.unitId,month:f.month,gross:null,net:null,kwh:null,reason:'Consumo sem conciliação.'};
 // Gross contracts already include taxes. Net contracts require explicit supplier-only tax bases.
 if(composition.supplier!==supplier.totalAmount)return {unitId:f.unitId,month:f.month,gross:null,net:null,kwh:quantity(volume),reason:'Compra do fornecedor sem conciliação.'};
 if(supplier.taxTreatment==='GROSS')return {unitId:f.unitId,month:f.month,gross:composition.supplier,net:null,kwh:quantity(volume),reason:'Tributos embutidos; não extraídos por alíquota presumida.'};
 if(supplier.taxTreatment==='NET'){
  const bases=new Set((prep.operationalTaxBases?.lines??[]).filter((l:any)=>l.scenario==='ACL'&&l.monetarySource?.startsWith('SUPPLIER_')).map((l:any)=>l.parameterId));
  const taxes=(prep.taxMemory?.lines??[]).filter((l:any)=>l.scenario==='ACL'),taxIds=new Set(taxes.map((l:any)=>l.id));
  if(bases.size&&taxes.length&&Array.isArray(prep.taxMemory?.pending)&&!prep.taxMemory.pending.length){
   const supplierTaxes=new Set<string>();let changed=true;
   while(changed){changed=false;for(const t of taxes){const refs=t.references??[];if(!supplierTaxes.has(t.id)&&refs.length&&refs.every((r:any)=>bases.has(r.id)||supplierTaxes.has(r.id))){supplierTaxes.add(t.id);changed=true;}}}
   const mixed=taxes.some((t:any)=>(t.references??[]).some((r:any)=>bases.has(r.id)||supplierTaxes.has(r.id))&&!supplierTaxes.has(t.id));
   const uncertain=taxes.some((t:any)=>(t.references??[]).some((r:any)=>taxIds.has(r.id)&&!supplierTaxes.has(r.id))&&(t.references??[]).some((r:any)=>bases.has(r.id)));
   if(!mixed&&!uncertain){const additions=taxes.filter((t:any)=>supplierTaxes.has(t.id));if([...bases].every(id=>additions.some((t:any)=>t.references.some((r:any)=>r.id===id)))&&additions.every((t:any)=>composition.entries.some((e:any)=>e.id===t.id&&e.group==='TAX'&&e.amount===t.amount))){const gross=feeMoney(feeCents(supplier.totalAmount)+additions.reduce((n:bigint,t:any)=>n+feeCents(t.amount),0n));return {unitId:f.unitId,month:f.month,gross,net:supplier.totalAmount,kwh:quantity(volume),reason:'Fornecedor líquido com tributos segregados na memória publicada; não comprova quitação.'};}}
  }
 }
 return {unitId:f.unitId,month:f.month,gross:null,net:null,kwh:quantity(volume),reason:'Tributos específicos do fornecedor exigem segregação antes deste indicador.'};
 });
 const months=Array.from({length:12},(_,i)=>{
 const month=year+'-'+String(i+1).padStart(2,'0'),selected=units.map(u=>prices.find((p:any)=>p.unitId===u.id&&p.month===month)),covered=units.length>0&&selected.every(p=>p?.gross!==null&&p?.gross!==undefined&&p?.kwh);
 const volume=covered?selected.reduce((n:bigint,p:any)=>n+decimal(p.kwh),0n):0n;
 const acl=covered?specificPrice(selected.reduce((n:bigint,p:any)=>n+feeCents(p.gross),0n),volume):null;
 const codes=baselines.map(b=>b.baseline.submarket);let pld:string|null=null,pldReference:string|null=null;
 if(units.length>0&&codes[0]&&codes.every(c=>c===codes[0])){const record=data.pld.find((p:any)=>p.month===month&&p.submarket===codes[0]);if(record){pldReference=record.value;pld=feeMoney((decimal(record.value)*100n+500000000n)/1000000000n);}}
 else if(covered&&codes.every(c=>['SE_CO','S','NE','N'].includes(c))){const records=codes.map(c=>data.pld.find((p:any)=>p.month===month&&p.submarket===c));if(records.every(Boolean)){pldReference=quantity(records.reduce((n:bigint,p:any,j:number)=>n+decimal(p.value)*decimal(selected[j].kwh),0n)/volume);pld=feeMoney((records.reduce((n:bigint,p:any,j:number)=>n+decimal(p.value)*decimal(selected[j].kwh),0n)*100n+volume*500000000n)/(volume*1000000000n));}}
 const a=acr===null?null:feeCents(acr),b=acl===null?null:feeCents(acl),diff=a!==null&&b!==null?a-b:null;
 const score=a&&diff!==null?(diff<0n?'-':'')+feeMoney(((diff<0n?-diff:diff)*10000n+a/2n)/a):null;
 return {month,acr,acl,pld,...pldSpreadScenarios(pldReference),scorePercent:score,coveredUnits:selected.filter(p=>p?.gross!=null).length,totalUnits:units.length};
 });
 const completeMonths=new Set(months.filter(m=>m.acl!==null).map(m=>m.month));
 const actual=prices.filter((p:any)=>completeMonths.has(p.month)&&p.gross!==null&&p.kwh),grossAverage=actual.length?specificPrice(actual.reduce((n:bigint,p:any)=>n+feeCents(p.gross),0n),actual.reduce((n:bigint,p:any)=>n+decimal(p.kwh),0n)):null;
 const netAverage=actual.length&&actual.every((p:any)=>p.net!==null)?specificPrice(actual.reduce((n:bigint,p:any)=>n+feeCents(p.net),0n),actual.reduce((n:bigint,p:any)=>n+decimal(p.kwh),0n)):null;
 const contractNet=complete&&baselines.every(b=>typeof b.baseline.contractNetBrlMwh==='string')?feeMoney((baselines.reduce((a,b)=>a+feeCents(b.baseline.contractNetBrlMwh)*decimal(b.baseline.annualKwh),0n)+baselines.reduce((a,b)=>a+decimal(b.baseline.annualKwh),0n)/2n)/baselines.reduce((a,b)=>a+decimal(b.baseline.annualKwh),0n)):null;
 const indicative=indicativePrice(acrNet,netAverage??contractNet);if(netAverage===null&&contractNet!==null)indicative.reason='Referência inicial: menor entre TE ACR anual e preço líquido da proposta de adesão, com as perdas configuradas. Proposta é cenário, não compra realizada. Valide vigência e condições com o Consultor.';
 return {organizationId:org,audience:portal?'client':'backoffice',customerId:data.customerId,year,units,baselines:baselines.map(b=>({...b,study:portal?null:b.study})),months,acrAverage:acr,aclAverage:grossAverage,indicative,canPublish:!portal&&data.canPublish===true,disclosure:'PLD + 5%, + 10% e + 15% são cenários estimados de mercado em R$/MWh; não representam cotação contratada nem incluem tributos presumidos. TE ACR anual e compra ACL em R$/MWh com tributos. PLD é referência de mercado sem os mesmos custos e tributos do contrato. Lacunas não são zero. Consolidado exige todas as unidades e é ponderado pelo consumo; não mistura clientes. Indicativo líquido exige tributos segregados.',footer:'Fonte: histórico cadastral aprovado e cenário de adesão (estimativa com tarifas de referência), apurações ACL publicadas e CCEE (PLD, quando integrada). ACR (R$/MWh) = [Σ(TE ponta + TE fora ponta com tributos) − Σ(créditos GD da TE)] ÷ Σ(kWh ponta + fora ponta) × 1.000. Compra ACL = Σ(custo de energia do fornecedor com tributos) ÷ Σ(kWh) × 1.000. Score (%) = (ACR − compra ACL) ÷ ACR × 100. Consolidado ponderado pelo consumo; exclui TUSD, demanda e honorários. Indicativo = menor referência ACR/ACL sem tributos; não contém tributo na indicação. Dados ausentes não são zero.'};
}

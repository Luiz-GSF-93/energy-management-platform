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
 let acl=covered?specificPrice(selected.reduce((n:bigint,p:any)=>n+feeCents(p.gross),0n),volume):null;
 let scoreAcl=acl;let monthAcr=acr,taxBasis='GROSS',priceNotice='Referência anual ACR e compra ACL com tributos explícitos.';
 const modern:any[]=(data.evaDetails??[]).filter((r:any)=>r.month===month);
 if(modern.length){
  if(modern.some((r:any)=>r.customerId!==data.customerId||!units.some(u=>u.id===r.unitId))||new Set(modern.map((r:any)=>r.unitId)).size!==modern.length)throw Error('Escopo da referência EVA divergente.');
  const full=modern.length===units.length&&modern.every((r:any)=>r.prices?.kwh);
  const totalVolume:bigint=full?modern.reduce((n:bigint,r:any)=>n+decimal(r.prices.kwh),0n):0n;
  const weighted=(key:string)=>full&&totalVolume>0n&&modern.every((r:any)=>typeof r.prices[key]==='string')?feeMoney((modern.reduce((n:bigint,r:any)=>n+feeCents(r.prices[key])*decimal(r.prices.kwh),0n)+totalVolume/2n)/totalVolume):null;
  monthAcr=weighted('acrNet');scoreAcl=weighted('aclNet');acl=data.workspaceV2?weighted('aclObserved'):scoreAcl;taxBasis=scoreAcl!==null?'NET':'UNKNOWN';
  priceNotice='Preço ACL observado do fornecedor; base fiscal indicada na publicação. TE ACR da biblioteca e ACL sem tributos somente quando explicitamente segregados. Parcela sem base fiscal não gera score. Não compare bases tributárias diferentes entre meses.';
 }
 const codes=baselines.map(b=>b.baseline.submarket??(data.workspaceV2?(data.submarkets??[]).find((v:any)=>v.unitId===b.unitId&&v.month===month)?.submarket:null));const pldWeights=modern.length&&data.workspaceV2?units.map(u=>modern.find((r:any)=>r.unitId===u.id)?.prices?.kwh):selected.map((p:any)=>p?.kwh);const pldVolume=pldWeights.length===units.length&&pldWeights.every((v:any)=>typeof v==='string'&&decimal(v)>0n)?pldWeights.reduce((n:bigint,v:any)=>n+decimal(v),0n):0n;let pld:string|null=null,pldReference:string|null=null;
 if(units.length>0&&codes[0]&&codes.every(c=>c===codes[0])){const record=data.pld.find((p:any)=>p.month===month&&p.submarket===codes[0]);if(record){pldReference=record.value;pld=feeMoney((decimal(record.value)*100n+500000000n)/1000000000n);}}
 else if(pldVolume>0n&&codes.every(c=>['SE_CO','S','NE','N'].includes(c))){const records=codes.map(c=>data.pld.find((p:any)=>p.month===month&&p.submarket===c));if(records.every(Boolean)){pldReference=quantity(records.reduce((n:bigint,p:any,j:number)=>n+decimal(p.value)*decimal(pldWeights[j]),0n)/pldVolume);pld=feeMoney((records.reduce((n:bigint,p:any,j:number)=>n+decimal(p.value)*decimal(pldWeights[j]),0n)*100n+pldVolume*500000000n)/(pldVolume*1000000000n));}}
 const a=monthAcr===null?null:feeCents(monthAcr),b=scoreAcl===null?null:feeCents(scoreAcl),diff=a!==null&&b!==null?a-b:null;
 const score=a&&diff!==null?(diff<0n?'-':'')+feeMoney(((diff<0n?-diff:diff)*10000n+a/2n)/a):null;
 const deltaPld=data.workspaceV2&&acl!==null&&pld!==null&&feeCents(pld)>0n?(()=>{const delta=feeCents(acl)-feeCents(pld),base=feeCents(pld);return (delta<0n?'-':'')+feeMoney(((delta<0n?-delta:delta)*10000n+base/2n)/base);})():null;
 return {month,acr:monthAcr,acl,pld,aclVsPldPercent:deltaPld,observedKwh:modern.length?quantity(modern.reduce((n:bigint,r:any)=>n+decimal(r.prices.kwh??'0'),0n)):quantity(volume),...pldSpreadScenarios(pldReference),scorePercent:score,taxBasis,priceNotice,coveredUnits:modern.length?modern.filter((r:any)=>r.prices.acrNet&&r.prices.aclNet).length:selected.filter(p=>p?.gross!=null).length,totalUnits:units.length};
 });
 const completeMonths=new Set(months.filter(m=>m.acl!==null).map(m=>m.month));
 const actual=prices.filter((p:any)=>completeMonths.has(p.month)&&p.gross!==null&&p.kwh),grossAverage=actual.length?specificPrice(actual.reduce((n:bigint,p:any)=>n+feeCents(p.gross),0n),actual.reduce((n:bigint,p:any)=>n+decimal(p.kwh),0n)):null;
 const netAverage=actual.length&&actual.every((p:any)=>p.net!==null)?specificPrice(actual.reduce((n:bigint,p:any)=>n+feeCents(p.net),0n),actual.reduce((n:bigint,p:any)=>n+decimal(p.kwh),0n)):null;
 const contractNet=complete&&baselines.every(b=>typeof b.baseline.contractNetBrlMwh==='string')?feeMoney((baselines.reduce((a,b)=>a+feeCents(b.baseline.contractNetBrlMwh)*decimal(b.baseline.annualKwh),0n)+baselines.reduce((a,b)=>a+decimal(b.baseline.annualKwh),0n)/2n)/baselines.reduce((a,b)=>a+decimal(b.baseline.annualKwh),0n)):null;
 const indicative=indicativePrice(acrNet,netAverage??contractNet);if(netAverage===null&&contractNet!==null)indicative.reason='Referência inicial: menor entre TE ACR anual e preço líquido da proposta de adesão, com as perdas configuradas. Proposta é cenário, não compra realizada. Valide vigência e condições com o Consultor.';
 return {organizationId:org,audience:portal?'client':'backoffice',customerId:data.customerId,year,units,baselines:baselines.map(b=>({...b,study:portal?null:b.study})),months,acrAverage:data.workspaceV2?averageObserved(months,'acr'):acr,aclAverage:data.workspaceV2?averageObserved(months,'acl'):grossAverage,indicative,workspaceV2:data.workspaceV2===true,canPublish:!portal&&data.canPublish===true,disclosure:'PLD + 5%, + 10% e + 15% são cenários estimados de mercado em R$/MWh; não representam cotação contratada nem incluem tributos presumidos. TE ACR anual e compra ACL em R$/MWh com tributos. PLD é referência de mercado sem os mesmos custos e tributos do contrato. Lacunas não são zero. Consolidado exige todas as unidades e é ponderado pelo consumo; não mistura clientes. Indicativo líquido exige tributos segregados.',footer:data.workspaceV2?'Fonte: fechamentos aprovados e publicados, biblioteca tarifária da comparação e PLD CCEE publicado por mês/submercado. TE ACL observado (R$/MWh) = energia do fornecedor ÷ consumo publicado × 1.000; não inclui TUSD, demanda ou honorários. ACL × PLD (%) = (TE ACL observado − PLD) ÷ PLD × 100; é diferença de preço, não economia final nem score líquido. Score ACR × ACL somente com bases fiscais compatíveis. Médias ponderadas pelo consumo dos meses disponíveis. Lacunas não são zero.':'Fonte: histórico cadastral aprovado e cenário de adesão (estimativa com tarifas de referência), apurações ACL publicadas e CCEE (PLD, quando integrada). ACR (R$/MWh) = [Σ(TE ponta + TE fora ponta com tributos) − Σ(créditos GD da TE)] ÷ Σ(kWh ponta + fora ponta) × 1.000. Compra ACL = Σ(custo de energia do fornecedor com tributos) ÷ Σ(kWh) × 1.000. Score (%) = (ACR − compra ACL) ÷ ACR × 100. Consolidado ponderado pelo consumo; exclui TUSD, demanda e honorários. Indicativo = menor referência ACR/ACL sem tributos; não contém tributo na indicação. Dados ausentes não são zero.'};
}

function averageObserved(months:any[],key:string){const available=months.filter(m=>typeof m[key]==='string'&&m.observedKwh&&decimal(m.observedKwh)>0n);if(!available.length)return null;const volume=available.reduce((n:bigint,m:any)=>n+decimal(m.observedKwh),0n);return feeMoney((available.reduce((sum:bigint,m:any)=>sum+feeCents(m[key])*decimal(m.observedKwh),0n)+volume/2n)/volume);}

import type {ContractSupplierData} from './ContractSupplierCost';
import type {TariffPreviewData} from './TariffPreview';
import type {TaxMemoryData} from './TaxMemory';
import type {MonthlyCostLedgerData} from './MonthlyCostLedger';
export type ComparisonInput={contractSupplierCost?:ContractSupplierData;tariffPreview?:TariffPreviewData;taxMemory?:TaxMemoryData;costLedger?:MonthlyCostLedgerData;catalog:{key:string;label:string;scenario:string;kind:string;timeBand:string;versions:{id:string}[]}[]};
export type ComparisonEntry={state:'VALUE'|'PENDING'|'DECLARED';label:string;amount?:string;detail:string;source?:string;revision?:number;recordId?:string;kind?:'TARIFF'|'TAX'|'COST'|'SUPPLIER'};
export type ComparisonRow={key:string;label:string;group:'tariffs'|'taxes'|'costs';ACR:ComparisonEntry[];ACL:ComparisonEntry[]};
const bands:Record<string,string>={ALL:'Todos os postos',PEAK:'Ponta',OFF_PEAK:'Fora ponta'};
const treatments:Record<string,string>={NET:'Sem tributos embutidos',GROSS:'Com tributos embutidos',INSIDE:'Por dentro',OUTSIDE:'Por fora',INCLUDED:'Tributos incluídos',EXCLUDED:'Tributos ainda não incluídos',NOT_APPLICABLE:'Não aplicável',EXEMPT:'Isenção declarada'};
export function comparisonMoney(value?:string){
 if(typeof value!=='string'||! /^-?(0|[1-9][0-9]*)\.[0-9]{2}$/.test(value))return 'Valor indisponível';
 const negative=value.startsWith('-'),[whole,cents]=value.replace('-','').split('.');
 return (negative?'− ':'')+'R$ '+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+cents;
}
// Presentation only: no totals, exchange of scenarios or inference of savings.
export function comparisonRows(data:ComparisonInput):ComparisonRow[]{
 const rows=new Map<string,ComparisonRow>();
 const add=(group:ComparisonRow['group'],key:string,label:string,scenario:string,entry:ComparisonEntry)=>{
  if(scenario!=='ACR'&&scenario!=='ACL')return;
  const id=group+':'+key;let row=rows.get(id);if(!row){row={key:id,label,group,ACR:[],ACL:[]};rows.set(id,row);}
  row[scenario].push(entry);
 };
 const catalog=(id:string)=>data.catalog.find(c=>c.versions.some(v=>v.id===id));
 const keyFor=(id:string,fallback:string)=>{const c=catalog(id);return c?c.key.split('/').slice(1).join('/'):fallback;};
 for(const l of data.tariffPreview?.lines||[]){
  if(data.contractSupplierCost&&l.scenario==='ACL'&&l.component==='TE')continue;
  if(data.tariffPreview?.pending.some(p=>p.parameterId===l.parameterId))continue;
  add('tariffs',keyFor(l.parameterId,l.component?'TARIFF/'+l.component+'/'+l.timeBand:'record/'+l.parameterId),l.label+' · '+(bands[l.timeBand]||l.timeBand),l.scenario,{state:'VALUE',label:l.label,amount:l.amount,detail:(treatments[l.treatment]||l.treatment)+(l.embeddedTaxCodes.length?' ('+l.embeddedTaxCodes.join(', ')+')':'')+' · '+l.quantity.replace('.',',')+' '+l.quantityUnit+' × '+l.rate.replace('.',',')+' '+l.measure.replace('BRL_','R$/'),source:l.source+(l.quantitySource?' · Quantidade: '+l.quantitySource:''),revision:l.revision,recordId:l.parameterId,kind:'TARIFF'});
 }
 for(const p of data.tariffPreview?.pending||[])add('tariffs',keyFor(p.parameterId,'record/'+p.parameterId),catalog(p.parameterId)?.label||p.label,p.scenario,{state:'PENDING',label:p.label,detail:p.reason,recordId:p.parameterId,kind:'TARIFF'});
 const supplier=data.contractSupplierCost;
 if(supplier)for(const band of ['PEAK','OFF_PEAK']){
  const line=supplier.bands.find(b=>b.timeBand===band);
  add('tariffs','TARIFF/TE/'+band,'Energia (TE) · '+bands[band],'ACL',{state:line?'VALUE':'PENDING',label:'Energia contratual do fornecedor',amount:line?.amount,detail:line?line.volumeMwh+' MWh cobertos pelo contrato · preço '+supplier.pricePerMwh+' R$/MWh · '+(supplier.taxTreatment==='NET'?'sem tributos':'tributos incluídos')+'. Mínimo não consumido e compra extra estão no card Fornecedor.':supplier.requirements.map(r=>r.message).join(' '),source:supplier.rule?.source,revision:supplier.rule?.version,recordId:supplier.contract?.id,kind:'SUPPLIER'});
 }
 for(const l of data.taxMemory?.lines||[]){if(data.taxMemory?.pending.some(p=>p.id===l.id))continue;add('taxes',keyFor(l.id,'TAX/'+l.code+'/ALL'),l.label,l.scenario,{state:'VALUE',label:l.label,amount:l.amount,detail:(treatments[l.treatment]||l.treatment)+' · '+l.rate.replace('.',',')+'%',source:l.source,revision:l.revision,recordId:l.id,kind:'TAX'});}
 for(const p of data.taxMemory?.pending||[])add('taxes',keyFor(p.id,'record/'+p.id),p.label,p.scenario,{state:'PENDING',label:p.label,detail:p.reason,recordId:p.id,kind:'TAX'});
 for(const d of data.taxMemory?.declarations||[])add('taxes',keyFor(d.id,'record/'+d.id),d.label,d.scenario,{state:'DECLARED',label:treatments[d.treatment]||d.treatment,detail:'Declaração aprovada; não representa um valor monetário calculado.',source:d.source,recordId:d.id,kind:'TAX'});
 const ledger=data.costLedger;
 if(ledger?.status==='AVAILABLE')for(const g of ledger.groups)add('costs',g.taxTreatment,'Custos e créditos · '+(treatments[g.taxTreatment]||g.taxTreatment),g.scenario,{state:'VALUE',label:'Saldo do grupo',amount:g.balance,detail:g.count+' lançamento(s) · custos '+comparisonMoney(g.costs)+' · créditos '+comparisonMoney(g.credits)+'. Não é o custo total do cenário.',source:ledger.version?.source,revision:ledger.version?.revision,kind:'COST'});
 if(ledger?.status==='NO_COSTS_DECLARED')for(const scenario of ['ACR','ACL'])add('costs','declared','Custos adicionais',scenario,{state:'DECLARED',label:'Ausência declarada',detail:'Ausência de custos e créditos adicionais validada para esta competência.',source:ledger.version?.source,kind:'COST'});
 if(ledger?.status==='BLOCKED')for(const scenario of ['ACR','ACL'])add('costs','blocked','Custos adicionais',scenario,{state:'PENDING',label:'Revisão necessária',detail:ledger.blockers.join(' '),kind:'COST'});
 return Array.from(rows.values()).sort((a,b)=>a.key.localeCompare(b.key));
}

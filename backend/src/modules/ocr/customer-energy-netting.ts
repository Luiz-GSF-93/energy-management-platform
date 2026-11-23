const scale=10n**12n;
const quantity=(s:unknown)=>{if(typeof s!=='string'||!/^(0|[1-9]\d{0,11})(\.\d{1,12})?$/.test(s))return null;const [w,f='']=s.split('.');return BigInt(w)*scale+BigInt(f.padEnd(12,'0'));};
const value=(n:bigint)=>String(n/scale)+'.'+String(n%scale).padStart(12,'0');
/** Customer netting is a separately attested monthly energy balance. It does not
 * rewrite a fiscal quantity, change any monetary amount or approve a settlement. */
export function customerEnergyNetting(entries:any[],org:string,customer:string,month:string,scope:string){
 const requested=entries.some(e=>e.context?.manualOverrides?.supplierInvoiceAllocation?.customerNetting);
 const denied=(reason:string)=>({requested,accepted:false as const,reason,units:[] as any[],proof:null as any});
 if(!requested)return denied('Sem compensação consolidada solicitada.');
 if(scope!=='CUSTOMER'||entries.length<2||entries.length>100||new Set(entries.map(e=>e.unitId)).size!==entries.length)return denied('Compensação de energia exige apuração consolidada com todas as unidades relacionadas.');
 const units:any[]=[];let required=0n,available=0n;
 for(const e of entries){
  const c=e.context,d=e.plan?.contractDraft,p=c?.supplierInvoiceProposal,a=d?.source?.allocation,b=d?.energyCoverage;
  if(!c||c.unit?.organization_id!==org||c.unit?.customer_id!==customer||c.unit?.id!==e.unitId||c.month!==month||d?.format!=='supplier-invoice-evidence-1'||!p||p.month!==month||a?.customerNetting?.customerId!==customer||typeof a.customerNetting.reason!=='string'||a.customerNetting.reason.trim().length<30||!a.actor||a.actor!==c.manualAuthor||a.documentId!==p.documentId||a.fileHash!==p.fileHash||d.source.documentId!==p.documentId||d.source.fileHash!==p.fileHash||b?.invoiceSource?.documentId!==p.documentId||b.invoiceSource.fileHash!==p.fileHash)return denied('Conferir as fontes e confirmações atuais de cada unidade para compensar energia.');
  const needed=quantity(b.requiredMwh),provided=quantity(b.availableMwh),invoice=quantity(p.quantityMwh),credit=quantity(b.creditMwh),consumption=quantity(b.consumptionMwh),loss=quantity(b.lossMwh);
  if([needed,provided,invoice,credit,consumption,loss].some(n=>n===null)||needed!==consumption!+loss!||provided!==invoice!+credit!)return denied('Memória de energia e fontes não conciliadas.');
  required+=needed!;available+=provided!;
  units.push({unitId:e.unitId,documentId:p.documentId,fileHash:p.fileHash,requiredMwh:b.requiredMwh,invoiceMwh:p.quantityMwh,proinfaMwh:b.creditMwh,availableMwh:b.availableMwh,actor:a.actor,reason:a.customerNetting.reason});
 }
 if(available<required)return denied('As NFs e os créditos energéticos documentados não cobrem o consumo consolidado com perdas.');
 return {requested,accepted:true as const,reason:'Compensação consolidada expressamente confirmada, mantendo NFs e valores por unidade.',units,proof:{format:'customer-energy-netting-1',organizationId:org,customerId:customer,month,requiredMwh:value(required),availableMwh:value(available),surplusMwh:value(available-required),units,financialApproval:false,canPublish:false}};
}
export function applyEnergyNettingToDraft(draft:any,proof:any){
 const requirements=draft.requirements.filter((r:any)=>r.code!=='SUPPLIER_ENERGY_COVERAGE');
 return {...draft,requirements,state:requirements.length?'PENDING':'COMPLETE',requiresHumanAcceptance:requirements.length>0,energyCoverage:{...draft.energyCoverage,state:'CUSTOMER_NETTED',netting:proof},differences:[...draft.differences,'Cobertura conciliada no conjunto das unidades: '+proof.availableMwh+' MWh disponíveis para '+proof.requiredMwh+' MWh com perdas. NFs, créditos e saldos individuais preservados; aprovação financeira separada.']};
}

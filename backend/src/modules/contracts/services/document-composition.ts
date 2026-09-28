type Reference={id:string;revision:number;kind:string;source:string};
export type DocumentEntry={id:string;revision:number;label:string;group:'SUPPLIER'|'ADDITIONAL';amount:string;source:string;references:Reference[]};
const valid=(v:any)=>v?.id&&Number.isInteger(v.revision)&&v.revision>0&&typeof v.source==='string'&&!!v.source.trim();
/** Final documented expenses only. NET amounts continue through explicit tax bases. */
export function reservedSupplierEntry(supplier:any):DocumentEntry {
 const s=supplier,r=s.reconciliation,v=s.costVersion,items=s.invoiceSources;
 if(s.formulaVersion!=='spot-supplier-1.0'||s.taxTreatment!=='RESERVED'||s.status!=='READY'||s.requirements.length||r?.status!=='APPROVED_TAX_RESERVATION'||!r.current||!r.id||!Number.isInteger(r.version)||r.version<1||!r.createdBy||!r.createdAt||(typeof r.reason!=='string'||r.reason.trim().length<20)||!r.documentId||!s.taxReservation?.createdBy||(typeof s.taxReservation.reason!=='string'||s.taxReservation.reason.trim().length<20)||!valid(v)||!v.validatedAt||!Array.isArray(items)||items.length!==1)throw Error('Fornecedor com ressalva exige conciliação atual, autor, justificativa e nota validada.');
 const i=items[0];
 if(!i.id||!i.source?.trim()||i.category!=='SUPPLIER_INVOICE'||i.effect!=='COST'||i.taxTreatment!=='RESERVED'||i.amount!==s.regularAmount||s.minimumAmount!=='0.00'||s.extraAmount!=='0.00'||s.totalAmount!==s.regularAmount||s.invoiceAmount!==s.regularAmount)throw Error('A nota conciliada diverge do valor documental do fornecedor.');
 const references:Reference[]=[{id:r.id,revision:r.version,kind:'SPOT_RECONCILIATION',source:r.reason},{id:v.id,revision:v.revision,kind:'MONTHLY_COSTS',source:v.source},{id:i.id,revision:v.revision,kind:'MONTHLY_COST_ITEM',source:i.source},{id:s.rule.id,revision:s.rule.version,kind:'SUPPLIER_BILLING_RULE',source:s.rule.source}];
 return {id:'document:supplier:'+i.id,revision:v.revision,label:'Fornecedor — valor documental com ressalva tributária',group:'SUPPLIER',amount:i.amount,source:i.source+' · Conciliação v'+r.version+': '+r.reason,references};
}
export function finalMonthlyEntries(group:any,version:any):DocumentEntry[]{
 if(group.taxTreatment!=='INCLUDED'||!valid(version)||!version.validatedAt)throw Error('Custos sem tributos confirmados exigem origem e tratamento aprovados.');
 return group.lines.map((i:any)=>({id:'document:monthly:'+i.id,revision:version.revision,label:i.label,group:'ADDITIONAL',amount:i.amount,source:i.source,references:[{id:version.id,revision:version.revision,kind:'MONTHLY_COSTS',source:version.source},{id:i.id,revision:version.revision,kind:'MONTHLY_COST_ITEM',source:i.source}]}));
}

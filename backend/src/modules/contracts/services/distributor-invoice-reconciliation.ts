import type {InvoiceAdjustments} from '../../ocr/cpfl-invoice-adjustments';
export type InvoiceFinancialEvidence={documentId:string;fileHash:string;layoutId?:string;financial:InvoiceAdjustments};
/** Match each approved document adjustment to its current OCR row before adding it. */
export function reconcileDistributorInvoice(evidence:InvoiceFinancialEvidence[],costs:any,entries:any[]){
 if(evidence.length!==1)throw Error('Selecione uma única fatura da distribuidora para conciliar o total.');
 const doc=evidence[0],f=doc.financial,elektro=doc.layoutId==='neoenergia-elektro-verde';
 const prefix=elektro?'OCR Elektro':'OCR CPFL';
 const absentCip=elektro&&f.cip===null&&f.cipSource===null;
 if(f.state!=='RECONCILED'||!f.total||!f.tariffs||(!f.cip&&!absentCip)||!doc.fileHash)throw Error('As operações OCR não conciliam com o total da distribuidora.');
 const lines=costs.groups.filter((g:any)=>g.scenario==='ACL').flatMap((g:any)=>g.lines.map((l:any)=>({...l,taxTreatment:g.taxTreatment})));
 const adjustments=lines.filter((l:any)=>l.category==='DISTRIBUTOR_ADJUSTMENT');
 if(adjustments.length!==f.items.length)throw Error('Integre e valide os ajustes de subvenção/devolução da fatura em Custos mensais.');
 for(const item of f.items){const source=prefix+' · ajuste · documento '+doc.documentId+' · SHA-256 '+doc.fileHash+' · '+item.source;const matches=adjustments.filter((l:any)=>l.source===source&&l.effect===item.effect&&l.amount===item.amount&&l.taxTreatment==='INCLUDED');if(matches.length!==1)throw Error('Um ajuste da distribuidora difere da fonte OCR atual. Revise sua versão.');}
 if(!absentCip){
 const cipSource=prefix+' · CIP · documento '+doc.documentId+' · SHA-256 '+doc.fileHash+' · '+f.cipSource;
 const cips=lines.filter((l:any)=>l.source===cipSource&&l.category==='CHARGE'&&l.effect==='COST'&&l.amount===f.cip&&l.taxTreatment==='INCLUDED');
 if(cips.length!==1)throw Error('Concilie uma única CIP com a fatura da distribuidora.');
 const entry=entries.filter(e=>e.id==='document:monthly:'+cips[0].id);
 if(entry.length!==1||entry[0].group!=='ADDITIONAL')throw Error('A CIP está ausente ou possui outra base de cálculo. Revise para não duplicar.');
 entry[0].group='DISTRIBUTOR';
 }
 const sum=entries.filter(e=>e.group==='DISTRIBUTOR').reduce((n,e)=>{if(typeof e.amount!=='string'||! /^-?(0|[1-9][0-9]*)[.][0-9]{2}$/.test(e.amount))throw Error('Valor da composição inválido.');return n+BigInt(e.amount.replace('.',''));},0n);
 const expected=BigInt(f.total.replace('.',''));
 if(sum!==expected)throw Error('A composição da distribuidora diverge do total a pagar. Confira tarifas, tributos e ajustes; nenhum total parcial será consolidado.');
 return {documentId:doc.documentId,fileHash:doc.fileHash,total:f.total,status:'RECONCILED' as const,...(absentCip?{cipObservation:'CIP não aparece na fatura. Total conciliado pelas operações presentes; ausência não representa isenção tributária.'}:{})};
}

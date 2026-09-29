import {cpflInvoiceAdjustments,type InvoiceAdjustments} from './cpfl-invoice-adjustments';
import type {extractCpflPaulistaLayout,CpflOperation} from './cpfl-paulista-layout';
export function invoiceFinancialAdjustments(layout:ReturnType<typeof extractCpflPaulistaLayout>):InvoiceAdjustments{
 if(layout.layoutId!=='neoenergia-elektro-verde')return cpflInvoiceAdjustments(layout.operations);
 const fail:InvoiceAdjustments={state:'REVIEW_REQUIRED',total:null,tariffs:null,cip:null,cipSource:null,items:[],issues:['Concilie as parcelas e o total da fatura Elektro.']};
 if(layout.reconciliation.state!=='MATCH')return fail;
 const totals=layout.fields.filter(f=>f.name==='invoiceTotal');if(!totals.length||new Set(totals.map(f=>f.value.decimal)).size!==1||totals.some(f=>f.value.issues.some(i=>i!=='MISSING_CONFIDENCE')))return fail;
 const t=totals[0],total:CpflOperation={source:t.source,row:-1,component:'TOTAL_A_PAGAR',role:'TOTAL',period:'UNSPECIFIED',fields:{amount:t.value},issues:[],arithmetic:{state:'NOT_VERIFIABLE',differenceCents:null}};
 return cpflInvoiceAdjustments([...layout.operations,total],false);
}

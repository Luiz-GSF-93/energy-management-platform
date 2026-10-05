import {reconcileDistributorInvoice} from './distributor-invoice-reconciliation';
const fixture=()=>{
 const items=[['a','COST','1344.58'],['b','COST','32642.42'],['c','CREDIT','74.53'],['d','CREDIT','25704.15'],['e','CREDIT','1291.20']].map(([source,effect,amount])=>({source,label:source,component:'TARIFF_SUBSIDY',effect,amount}));
 const doc:any={documentId:'doc',fileHash:'hash',layoutId:'neoenergia-elektro-verde',financial:{state:'RECONCILED',total:'76762.76',tariffs:'69845.64',cip:null,cipSource:null,items,issues:[]}};
 const lines=items.map(i=>({...i,id:i.source,source:'OCR Elektro · ajuste · documento doc · SHA-256 hash · '+i.source,category:'DISTRIBUTOR_ADJUSTMENT'}));
 const costs:any={groups:[{scenario:'ACL',taxTreatment:'INCLUDED',lines}]};
 const entries:any[]=[{id:'tariffs',group:'DISTRIBUTOR',amount:'69845.64'},...items.map(i=>({id:'document:monthly:'+i.source,group:'DISTRIBUTOR',amount:(i.effect==='CREDIT'?'-':'')+i.amount})),{id:'supplier',group:'SUPPLIER',amount:'46748.42'},{id:'supplierTax',group:'TAX',amount:'10261.85'}];return {doc,costs,entries};
};
describe('distributor invoice reconciliation across layouts',()=>{
 it('conciliates the actual Elektro total without inventing CIP or adding supplier taxes',()=>{const x=fixture();expect(reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toMatchObject({total:'76762.76',status:'RECONCILED',cipObservation:expect.stringContaining('CIP não aparece')});});
 it.each(['cpfl-paulista-a',undefined,'unknown'])('preserves CIP requirement for layout %s',(layoutId)=>{const x=fixture();x.doc.layoutId=layoutId;expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('operações OCR');});
 it('does not treat missing CIP source for a present charge as absence',()=>{const x=fixture();x.doc.financial.cip='1.00';expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('CIP');});
 it('rejects unreconciled OCR',()=>{const x=fixture();x.doc.financial.state='REVIEW_REQUIRED';expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('operações OCR');});
 it('rejects wrong source layout',()=>{const x=fixture();x.costs.groups[0].lines[0].source=x.costs.groups[0].lines[0].source.replace('Elektro','CPFL');expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('fonte OCR');});
 it('rejects altered adjustment amounts',()=>{const x=fixture();x.costs.groups[0].lines[0].amount='1344.57';expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('fonte OCR');});
 it('rejects duplicate adjustment',()=>{const x=fixture();x.costs.groups[0].lines.push(x.costs.groups[0].lines[0]);expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('ajustes');});
 it('rejects a missing cent rather than returning partial totals',()=>{const x=fixture();x.entries[0].amount='69845.63';expect(()=>reconcileDistributorInvoice([x.doc],x.costs,x.entries)).toThrow('total a pagar');});
 it('rejects multiple invoices',()=>{const x=fixture();expect(()=>reconcileDistributorInvoice([x.doc,x.doc],x.costs,x.entries)).toThrow('única fatura');});
 it('preserves CPFL CIP reconciliation including explicit zero',()=>{const x=fixture();x.doc.layoutId='cpfl-paulista-a';x.doc.financial.cip='0.00';x.doc.financial.cipSource='cip';x.costs.groups[0].lines.forEach((l:any)=>l.source=l.source.replace('Elektro','CPFL'));x.costs.groups[0].lines.push({id:'cip',source:'OCR · documento doc · SHA-256 hash · cip',category:'CHARGE',effect:'COST',amount:'0.00'});x.entries.push({id:'document:monthly:cip',group:'ADDITIONAL',amount:'0.00'});expect(reconcileDistributorInvoice([x.doc],x.costs,x.entries).status).toBe('RECONCILED');expect(x.entries[x.entries.length-1].group).toBe('DISTRIBUTOR');});
});

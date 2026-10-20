import {assistedClosingReport,historicalDifference} from './eva-assisted-closing.model';
const entry=():any=>({unitId:'unit',name:'Teste',context:{document:{id:'doc'},captured:{parameters:[]}},plan:{library:{id:'lib'},fields:[{key:'ACR:TE:ALL',state:'FILLED',value:'1'},...['ICMS','PIS','COFINS'].map(code=>({key:'ACR:tax:'+code,state:'FILLED',value:{treatment:'EXEMPT'}})),{key:'supplier:tax',state:'FILLED',value:'INCLUDED'},{key:'fee:fixed',state:'FILLED',value:'50.00'},{key:'costs:monthly',state:'FILLED',value:{noCosts:true,items:[]}}],operational:{state:'PARTIAL',invoice:{amount:'200.00'},supplier:{amount:'500.00'},acr:{lines:[{key:'ACR:TE:ALL',amount:'1000.00',quantity:'1000',rate:'1',measure:'BRL_KWH'}]}},referenceUsed:false}});
const report=(e:any[]= [entry()])=>assistedClosingReport('org','customer','2026-09',e);
describe('EVA assisted closing',()=>{
 it('reconciles internal totals without automatic approval/publication',()=>{expect(report()).toMatchObject({completeness:'COMPLETE',approvalEligible:true,automaticApproval:false,publicationAllowed:false,financial:{acr:'1000.00',aclBeforeFees:'700.00',aclAfterFees:'750.00',savings:'250.00'}})});
 it('accepts an exact monetary number serialized by PostgreSQL without rounding',()=>{const e=entry();e.plan.fields.find((f:any)=>f.key==='fee:fixed').value=1302.05;expect(report([e]).financial.fixedFee).toBe('1302.05');expect(report([e]).approvalEligible).toBe(true)});
 it('rejects fractional cents instead of inventing a rounded fee',()=>{const e=entry();e.plan.fields.find((f:any)=>f.key==='fee:fixed').value=1302.051;expect(report([e]).approvalEligible).toBe(false)});
 it('labels a reference estimate',()=>{const e=entry();e.plan.referenceUsed=true;expect(report([e]).completeness).toBe('ESTIMATED')});
 it.each(['ICMS','PIS','COFINS'])('requires %s evidence',code=>{const e=entry();e.plan.fields=e.plan.fields.filter((f:any)=>f.key!=='ACR:tax:'+code);expect(report([e]).approvalEligible).toBe(false)});
 it('lists missing quantities and all tax bases in the same report',()=>{const e=entry();e.plan.fields=e.plan.fields.filter((f:any)=>!f.key.includes(':tax:'));e.plan.fields.push({key:'ACR:TUSD_DEMAND_USED:ALL',state:'FILLED',value:'10'});const missing=report([e]).missing.join(' ');expect(missing).toContain('quantidade faturável');expect(missing).toContain('ICMS, PIS, COFINS')});
 it('does not convert RESERVED to final supplier cost',()=>{const e=entry();e.plan.fields.find((f:any)=>f.key==='supplier:tax').value='RESERVED';expect(report([e]).financial.status).toBe('INCOMPLETE')});
 it('does not substitute measured demand',()=>{const e=entry();e.plan.fields.push({key:'ACR:TUSD_DEMAND_USED:ALL',state:'FILLED',value:'10'});expect(report([e]).missing.join()).toContain('quantidade faturável')});
 it('requires all units',()=>{expect(report([entry(),{unitId:'other',name:'Other',unavailable:'Sem fatura'}]).approvalEligible).toBe(false);expect(report([]).approvalEligible).toBe(false)});
 it('does not double count invoice costs',()=>{const e=entry();e.plan.fields.find((f:any)=>f.key==='costs:monthly').value={noCosts:false,items:[{scenario:'ACL',source:'doc',amount:'20.00'},{scenario:'ACL',source:'recibo',amount:'10.00',taxTreatment:'INCLUDED',effect:'COST'}]};expect(report([e]).financial.aclBeforeFees).toBe('710.00')});
 it('reconciles hybrid variable fees',()=>{const e=entry();e.plan.fields.push({key:'fee:percentage',state:'FILLED',value:'10'},{key:'fee:allocation',state:'FILLED',value:[{consumerUnitId:'unit',percentage:'100'}]});expect(report([e]).financial).toMatchObject({variableFee:'30.00',totalFees:'80.00',savings:'220.00'})});
 it('handles zero and unavailable comparison',()=>{expect(historicalDifference('kWh','120','100','kWh')).toMatchObject({difference:'20.000000',percent:'20.00'});expect(historicalDifference('kWh','120','0','kWh').percent).toBeNull();expect(historicalDifference('kWh',null,'100','kWh').comparable).toBe(false)});
});


it('V3 requires demonstrated extra energy and invoice reconciliation instead of showing a partial supplier as final',()=>{
 const prior=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
 try{process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';const e=entry();e.context.diagnosis={contractSupplierCost:{requirements:[{code:'EXTRA_PURCHASE',message:'Compra extra exige valor e fonte.'}]}};
  const r=report([e]);expect(r.approvalEligible).toBe(false);expect(r.financial.savings).toBeNull();expect(r.missing.join(' ')).toContain('Compra extra exige valor e fonte.');
 }finally{if(prior===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=prior;}
});

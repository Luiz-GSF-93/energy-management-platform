import {contractClosingDraft,contractClosingDraftEnabled,contractClosingDraftApplicable,CONTRACT_CLOSING_DRAFT_FLAG} from './contract-closing-draft';
import {indexMemoryHash,indexMemoryPlan,calculateIndexMemory} from '../contracts/services/contract-index-memory.model';
import {normalizeContractVolume,contractAdjustmentTerms} from './source-preparation-v3';
import {assistedClosingReport} from './eva-assisted-closing.model';
const docId='00000000-0000-4000-8000-000000000001';
function fixture(month='2026-03'){
 const scope={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit'};
 const contract={...scope,id:'contract',contract_number:'TEST',contract_type:'ENERGY_PURCHASE',status:'ACTIVE',start_date:'2026-01-01',end_date:'2026-04-30',current_price:118};
 const parameters={month,basePrice:'118',baseDate:'2023-07-01',firstAdjustment:'2024-04-01',frequencyMonths:12,index:'IPCA' as const,sourceDocumentId:docId,sourceNote:'Anexo I, página 21, condições de suprimento verificadas.'};
 const plan=indexMemoryPlan(parameters),indices={'2023-06':'6659.95',[plan.referenceMonth!]:month==='2026-03'?'7245.38':'7545.53'};
 const data=[{V:'Valor'},...plan.periods.map(m=>({NC:'1',D1C:'1',D2C:'2266',MC:'30',D3C:m.replace('-',''),V:indices[m]}))];
 const memory:any={...scope,contract_id:'contract',id:'memory',version:1,parameters,plan,contract_snapshot:contract,source_document:{id:docId,fileHash:'b'.repeat(64)},state:'COMPLETE',created_by:'actor',created_at:'2026-10-20T10:00:00Z',consent_at:'2026-10-20T10:01:00Z',expires_at:'2026-10-20T10:10:00Z',consent_note:'Autorização explícita para série e meses concretos.',finished_at:'2026-10-20T10:01:03Z',result:{financialApplication:false,calculation:calculateIndexMemory(parameters,indices,118),evidence:{data,sha256:indexMemoryHash(data),url:plan.url,retrievedAt:'2026-10-20T10:01:02Z'}}};
 const c:any={month,ready:true,period:{start:month+'-01',end:month+(month==='2026-03'?'-31':'-30')},unit:{...scope,id:'unit',free_market:true},document:{id:'invoice',file_hash:'a'.repeat(64)},originalIdentity:{state:'MATCH',fileHash:'a'.repeat(64)},measurements:month==='2026-03'?{consumptionPeak:'11930.4850',consumptionOffPeak:'99735.3117',consumptionTotal:'111665.7967'}:{consumptionPeak:'10709.5800',consumptionOffPeak:'93591.6800',consumptionTotal:'104301.2600'},captured:{contracts:[contract],billingRules:[{...scope,id:'rule',version:1,contract_id:'contract',start_date:'2026-01-01',end_date:'2026-04-30',source:'Cláusula fiscal demonstrada na simulação',tax_treatment:'GROSS'}]},sourcePreparation:{documents:[{contractId:'contract',documentId:docId,link:'REGISTERED_CONTRACT_DOCUMENT',sourceHash:'b'.repeat(64),conflicts:['Volume cadastrado divergente do anexo'],annex:{state:'PROPOSED',period:{start:'2024-04-01',end:'2027-12-31'},sources:[{page:21,sectionHash:'c'.repeat(64)}],volumeTerms:normalizeContractVolume(month,'0.1','0.5','1.4'),modulation:'FLAT',price:'118.00',index:'IPCA/IBGE',adjustment:{index:'IPCA',baseDate:'2023-07-01',firstAdjustment:'2024-04-01',frequencyMonths:12}}}]},cost:{...scope,id:'cost',month,status:'DRAFT',created_by:'actor',source_reference:'Documentos da competência',costs:{noCosts:false,items:[{id:'extra',category:'SUPPLIER_EXTRA_ENERGY',scenario:'ACL',amount:'100.00',effect:'COST',taxTreatment:'INCLUDED',source:'Nota extra da competência'},{id:'ccee',category:'CCEE',scenario:'ACL',amount:'20.00',effect:'COST',taxTreatment:'INCLUDED',source:'Extrato CCEE da competência'}]}}};
 return {c,memory};
}
describe('source-backed monthly contract draft',()=>{
 it('preserves existing structured supplier flows without a verified indexed annex',()=>{const {c}=fixture();expect(contractClosingDraftApplicable(c)).toBe(true);c.sourcePreparation.documents[0].link='CANDIDATE_REQUIRES_REVIEW';expect(contractClosingDraftApplicable(c)).toBe(false);expect(contractClosingDraftApplicable({})).toBe(false);});
 it.each([['2026-03','74.4','104.160000000000','7.505796700000','128.372561'],['2026-04','72','100.800000000000','3.501260000000','133.690574']])('normalizes volume and recomputes the indexed price for %s',(month,volume,max,extra,price)=>{
  const {c,memory}=fixture(month),before=JSON.stringify(c),r=contractClosingDraft(c,[memory]);
  expect(r).toMatchObject({state:'COMPLETE',requiresHumanAcceptance:true,financialApproval:false,canPublish:false,supplier:{contractedMwh:volume,maxMwh:max,extraMwh:extra,pricePerMwh:price,extraAmount:'100.00'}});
  expect(r.consumedCostSources).toHaveLength(1);expect(JSON.stringify(c)).toBe(before);
 });
 it('is off by default and accepts only the explicit true flag',()=>{const prior=process.env[CONTRACT_CLOSING_DRAFT_FLAG];try{delete process.env[CONTRACT_CLOSING_DRAFT_FLAG];expect(contractClosingDraftEnabled()).toBe(false);process.env[CONTRACT_CLOSING_DRAFT_FLAG]='1';expect(contractClosingDraftEnabled()).toBe(false);process.env[CONTRACT_CLOSING_DRAFT_FLAG]='true';expect(contractClosingDraftEnabled()).toBe(true);}finally{if(prior===undefined)delete process.env[CONTRACT_CLOSING_DRAFT_FLAG];else process.env[CONTRACT_CLOSING_DRAFT_FLAG]=prior;}});
 it.each(['DRAFT','CANCELLED','FETCHING','FAILED'])('does not use a %s index memory',state=>{const {c,memory}=fixture();memory.state=state;const r=contractClosingDraft(c,[memory]);expect(r.state).toBe('PENDING');expect(r.supplier.pricePerMwh).toBeNull();});
 it('uses the newest version, never falls back to an old complete memory',()=>{const {c,memory}=fixture();expect(contractClosingDraft(c,[memory,{...memory,id:'new',version:2,state:'DRAFT'}]).state).toBe('PENDING');});
 it.each([
  (m:any)=>m.parameters.basePrice='119',
  (m:any)=>m.parameters.baseDate='2023-08-01',
  (m:any)=>m.source_document.fileHash='d'.repeat(64),
  (m:any)=>m.contract_snapshot.current_price=119,
  (m:any)=>m.consent_at=null,
  (m:any)=>m.consent_at='2026-10-20T10:11:00Z',
  (m:any)=>m.result.calculation.pricePerMwh='1.000000',
  (m:any)=>m.result.evidence.data[1].V='1',
  (m:any)=>m.result.evidence.url='https://untrusted.example',
  (m:any)=>m.result.financialApplication=true,
 ])('rejects altered calculation or consent evidence %#',change=>{const {c,memory}=fixture();memory.contract_snapshot=structuredClone(memory.contract_snapshot);change(memory);const r=contractClosingDraft(c,[memory]);expect(r.state).toBe('PENDING');expect(r.memory).toBeNull();});
 it.each(['organization_id','customer_id','consumer_unit_id','contract_id'])('never consumes a memory outside %s',key=>{const {c,memory}=fixture();memory[key]='other';expect(contractClosingDraft(c,[memory]).memory).toBeNull();});
 it('does not accept duplicate memory versions',()=>{const {c,memory}=fixture();expect(contractClosingDraft(c,[memory,{...memory,id:'other'}]).state).toBe('PENDING');});
 it('preserves a regular amount but blocks the final total without the extra purchase',()=>{const {c,memory}=fixture();c.cost.costs.items=c.cost.costs.items.filter((i:any)=>i.id!=='extra');const r=contractClosingDraft(c,[memory]);expect(r.supplier.regularAmount).not.toBeNull();expect(r.supplier.totalAmount).toBeNull();expect(r.requirements.map((x:any)=>x.code)).toContain('EXTRA_PURCHASE');});
 it('does not infer fiscal treatment or CCEE zero from absence',()=>{const {c,memory}=fixture();c.captured.billingRules=[];c.cost.costs.items=[];const r=contractClosingDraft(c,[memory]);expect(r.requirements.map((x:any)=>x.code)).toEqual(expect.arrayContaining(['SUPPLIER_TAX_SOURCE','CCEE_COVERAGE','EXTRA_PURCHASE']));});
 it.each(['wrong unit','wrong identity','unlinked annex','ambiguous contract','unknown conflict','bad sums','duplicate item','fractional cent'])('blocks %s',bad=>{const {c,memory}=fixture();switch(bad){case 'wrong unit':c.unit.id='other';break;case 'wrong identity':c.originalIdentity.state='MISMATCH';break;case 'unlinked annex':c.sourcePreparation.documents[0].link='OTHER';break;case 'ambiguous contract':c.captured.contracts.push({...c.captured.contracts[0],id:'other'});break;case 'unknown conflict':c.sourcePreparation.documents[0].conflicts=['Cláusula divergente'];break;case 'bad sums':c.measurements.consumptionTotal='1';break;case 'duplicate item':c.cost.costs.items.push(c.cost.costs.items[0]);break;case 'fractional cent':c.cost.costs.items[0].amount='1.001';break;}expect(contractClosingDraft(c,[memory]).state).toBe('PENDING');});
 it('does not revive an older billing rule or ignore overlapping contracts',()=>{const {c,memory}=fixture();c.captured.billingRules.push({...c.captured.billingRules[0],id:'new',version:2,start_date:'2026-03-15'});expect(contractClosingDraft(c,[memory]).state).toBe('PENDING');c.captured.contracts.push({...c.captured.contracts[0],id:'partial',start_date:'2026-03-15'});expect(contractClosingDraft(c,[memory]).contractId).toBeNull();});
 it('accepts PostgreSQL JSONB property order without changing the evidence',()=>{const {c,memory}=fixture();memory.plan=Object.fromEntries(Object.entries(memory.plan).reverse());expect(contractClosingDraft(c,[memory]).state).toBe('COMPLETE');});
 it('counts demonstrated extra energy once, CCEE once, and leaves approval human',()=>{
  const previous=process.env[CONTRACT_CLOSING_DRAFT_FLAG],v3=process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;
  try{process.env[CONTRACT_CLOSING_DRAFT_FLAG]='true';process.env.EVA_SOURCE_PREPARATION_V3_ENABLED='true';
   const {c,memory}=fixture();c.contractDraft=contractClosingDraft(c,[memory]);
   const draft=c.contractDraft,plan:any={contractDraft:draft,sourcePreparation:c.sourcePreparation,library:{id:'lib'},fields:[{key:'ACR:TE:ALL',state:'FILLED',value:'1'},...['ICMS','PIS','COFINS'].map(code=>({key:'ACR:tax:'+code,state:'FILLED',value:{treatment:'EXEMPT'}})),{key:'supplier:tax',state:'FILLED',value:'GROSS'},{key:'fee:fixed',state:'FILLED',value:'1302.05'},{key:'costs:monthly',state:'FILLED',value:c.cost.costs}],operational:{state:'PARTIAL',invoice:{amount:'33959.78'},supplier:{amount:draft.supplier.totalAmount},acr:{lines:[{key:'ACR:TE:ALL',amount:'60000.00',quantity:'60000',rate:'1',measure:'BRL_KWH'}]}}};
   const run=()=>assistedClosingReport('org','customer','2026-03',[{unitId:'unit',name:'Simulação',plan,context:c}]);
   let r=run();expect(r).toMatchObject({approvalEligible:true,automaticApproval:false,publicationAllowed:false});
   expect(Number(r.financial.aclBeforeFees)).toBeCloseTo(33959.78+Number(draft.supplier.regularAmount)+100+20,2);
   // Changing an already-consumed item invalidates its proof, never silently adds or skips it.
   c.cost.costs.items[0].amount='200.00';r=run();expect(r.approvalEligible).toBe(false);expect(r.missing.join(' ')).toContain('dupla contagem');
  }finally{if(previous===undefined)delete process.env[CONTRACT_CLOSING_DRAFT_FLAG];else process.env[CONTRACT_CLOSING_DRAFT_FLAG]=previous;if(v3===undefined)delete process.env.EVA_SOURCE_PREPARATION_V3_ENABLED;else process.env.EVA_SOURCE_PREPARATION_V3_ENABLED=v3;}
 });
 it('parses one complete annex adjustment header and rejects ambiguous/invalid dates',()=>{const text='Reajuste Data Base 1º Reajuste Periodicidade 01/07/2023 01/04/2024 12 meses IPCA/IBGE';expect(contractAdjustmentTerms(text)).toEqual({index:'IPCA',baseDate:'2023-07-01',firstAdjustment:'2024-04-01',frequencyMonths:12});expect(contractAdjustmentTerms(text+' '+text)).toBeNull();expect(contractAdjustmentTerms(text.replace('01/07','31/07'))).toBeNull();});
});

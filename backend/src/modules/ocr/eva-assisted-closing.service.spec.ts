import {invoiceComponentTaxV3} from './invoice-component-tax-v3';
jest.mock('./invoice-component-tax-v3',()=>({invoiceComponentTaxV3:jest.fn()}));
import {invoiceComparisonV2} from './invoice-comparison-v2';
jest.mock('./invoice-comparison-v2',()=>({invoiceComparisonV2:jest.fn()}));
import {EvaAssistedClosingService} from './eva-assisted-closing.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
const unit='00000000-0000-4000-8000-000000000001',id='00000000-0000-4000-8000-000000000002',t:any={organizationId:'org',userId:'actor',roleId:'role',role:'admin_org',permissions:[P.ENERGIA_OCR_PROCESS,P.ORGANIZATION_CONTRACTS_CREATE]},b={consumerUnitId:unit,month:'2026-09',requestId:id};
function setup(enabled=true,comparison=false,automatic=false,componentTaxes=false){const actions:string[]=[],payloads:any[]=[];let handler=(a:string):any=>({data:a==='history'?{rows:[],canPrepare:true}:a==='capture'?{financial:{tables:{consumer_units:[{id:unit,organization_id:'org',customer_id:'customer',status:'ACTIVE'}]}}}:a==='reserve'?{acquired:true,row:{id}}:{id,state:'INCOMPLETE'}});const snap=jest.fn(async()=>({available:false,observation:'Fatura ausente'}));const prepare=jest.fn(async(_body:any,_tenant:any)=>({run:{state:'PARTIAL'}}));const s=new EvaAssistedClosingService({getClient:()=>({rpc:async(n:string,p:any)=>{actions.push(p.p_action);payloads.push(p);return handler(p.p_action)}})} as any,{get:(key:string)=>(key==='EVA_ASSISTED_CLOSING_ENABLED'&&enabled||key==='EVA_INVOICE_COMPARISON_ENABLED'&&comparison||key==='CALCULATION_AUTOFILL_ENABLED'&&automatic||key==='EVA_COMPONENT_TAX_CLOSING_ENABLED'&&componentTaxes)?'true':'false'} as any,{closingSnapshot:snap,prepare} as any);return {s,actions,payloads,snap,prepare,set:(h:typeof handler)=>handler=h};}
describe('assisted service',()=>{
 it('projects only scoped unit metadata for dialogue without writes',async()=>{const x=setup();const r=await x.s.dialogueUnit({consumerUnitId:unit,month:b.month},t);expect(r.id).toBe(unit);expect(r).not.toHaveProperty('customer_id');expect(x.actions).toEqual(['capture'])});
 it('refuses a different tenant unit in dialogue capture',async()=>{const x=setup();x.set(()=>({data:{financial:{tables:{consumer_units:[{id:unit,organization_id:'other'}]}}}}));await expect(x.s.dialogueUnit({consumerUnitId:unit,month:b.month},t)).rejects.toThrow('escopo');expect(x.actions).toEqual(['capture'])});
 it('performs no access with flag disabled',async()=>{const x=setup(false);expect(await x.s.history({},t)).toEqual({enabled:false});await expect(x.s.prepare(b,t)).rejects.toThrow();expect(x.actions).toEqual([])});
 it('requires permission before capture',async()=>{const x=setup();x.set(()=>({data:{rows:[],canPrepare:false}}));await expect(x.s.prepare(b,t)).rejects.toThrow();expect(x.actions).toEqual(['history'])});
 it('reserves before finish without external calls or source writes',async()=>{const x=setup();await x.s.prepare(b,t);expect(x.actions).toEqual(['history','capture','reserve','finish']);expect(x.snap).toHaveBeenCalledTimes(1)});
 it('replays before collecting sources',async()=>{const x=setup();x.set(()=>({data:{rows:[{id}],canPrepare:true}}));expect((await x.s.prepare(b,t)).replayed).toBe(true);expect(x.actions).toEqual(['history'])});
 it('rejects cross tenant capture',async()=>{const x=setup();x.set(a=>({data:a==='history'?{rows:[],canPrepare:true}:{financial:{tables:{consumer_units:[{id:unit,organization_id:'other',customer_id:'customer'}]}}}}));await expect(x.s.prepare(b,t)).rejects.toThrow();expect(x.actions).not.toContain('reserve')});
 it('requires human acknowledgment',async()=>{const x=setup();await expect(x.s.decide({...b,id,decision:'APPROVE',hash:'a'.repeat(64),note:'Conferência das fontes completa.',acknowledge:false},t)).rejects.toThrow();expect(x.actions).toEqual([])});
 it('preserves an unresolved commercial reservation as incomplete',async()=>{const x=setup();x.snap.mockResolvedValueOnce({available:true,plan:{fields:[],operational:{state:'PARTIAL'}},c:{document:{id:'doc'}}} as any);x.set(a=>({data:a==='history'?{rows:[],canPrepare:true}:a==='capture'?{financial:{tables:{consumer_units:[{id:unit,organization_id:'org',customer_id:'customer',status:'ACTIVE'}]}},commercial:[{consumer_unit_id:unit,state:'UNKNOWN'}]}:a==='reserve'?{acquired:true,row:{id}}:{id,state:'INCOMPLETE'}}));await x.s.prepare(b,t);expect(x.payloads.find(p=>p.p_action==='reserve').p_body.report.missing.join(' ')).toContain('reserva de preparação comercial');});
 it.each([false,true])('uses the new comparison only under its existing flag: %s',async enabled=>{const compare=invoiceComparisonV2 as jest.Mock;compare.mockReset();compare.mockReturnValue({method:'SAME_INVOICE_AMOUNTS_V2',amount:'100.00',missing:[],observations:[],lines:[],retained:[]});const x=setup(true,enabled);x.snap.mockResolvedValueOnce({available:true,plan:{fields:[],operational:{state:'PARTIAL',invoice:{amount:'2.00'},supplier:{amount:'1.00'}}},c:{document:{id:'doc'}}} as any);await x.s.prepare(b,t);expect(compare).toHaveBeenCalledTimes(enabled?1:0);expect(x.payloads.find(p=>p.p_action==='reserve').p_body.report.methodology).toBe(enabled?'SAME_INVOICE_AMOUNTS_V2':'SOURCE_BILLING_V1')});
 it('does not retry source races',async()=>{const x=setup();x.set(()=>({error:{code:'40001'}}));await expect(x.s.history({consumerUnitId:unit,month:b.month},t)).rejects.toThrow('mudaram');expect(x.actions).toHaveLength(1)});
});

describe('assisted closing connects existing source-backed draft preparation',()=>{
 const capture={financial:{tables:{consumer_units:[{id:unit,organization_id:'org',customer_id:'customer',status:'ACTIVE'}]}}};
 const candidate=()=>({available:true,basis:'b'.repeat(64),token:'c'.repeat(64),plan:{fields:[],operational:{state:'PARTIAL'}},c:{ready:false,proposalReady:true,document:{id:'doc'}}});
 it('prepares drafts before recapturing sources and rendering the closing',async()=>{
  const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);let count=0;
  x.set(a=>({data:a==='history'?{rows:[],canPrepare:true}:a==='capture'?{...capture,revision:++count}:a==='reserve'?{acquired:true,row:{id}}:{id,state:'INCOMPLETE'}}));
  x.prepare.mockImplementation(async()=>{expect(x.actions).toEqual(['history','capture']);return {run:{state:'PARTIAL'}}});
  await x.s.prepare(b,t);expect(x.prepare).toHaveBeenCalledTimes(1);expect(x.prepare).toHaveBeenCalledWith(expect.objectContaining({consumerUnitId:unit,month:b.month,token:'c'.repeat(64),requestId:expect.stringMatching(/^[a-f0-9-]{36}$/)}),t);expect(x.actions).toEqual(['history','capture','capture','reserve','finish']);expect(x.snap).toHaveBeenCalledTimes(2);expect(x.payloads.find(p=>p.p_action==='reserve').p_body.sources.revision).toBe(2);
 });
 it('keeps a stable draft request key for the same closing request and source basis',async()=>{const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);await x.s.prepare(b,t);await x.s.prepare(b,t);expect(x.prepare.mock.calls[0][0].requestId).toBe(x.prepare.mock.calls[1][0].requestId)});
 it.each(['RUNNING','UNKNOWN'])('never finalizes a closing after uncertain draft preparation: %s',async state=>{const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);x.prepare.mockResolvedValue({run:{state}});await expect(x.s.prepare(b,t)).rejects.toThrow('não confirmada');expect(x.actions).toEqual(['history','capture']);expect(x.prepare).toHaveBeenCalledTimes(1)});
 it('does not prepare drafts with the existing flag disabled',async()=>{const x=setup();x.snap.mockResolvedValue(candidate() as any);await x.s.prepare(b,t);expect(x.prepare).not.toHaveBeenCalled();expect(x.actions).toEqual(['history','capture','reserve','finish'])});
 it('does not expand a report preparer into an OCR writer',async()=>{const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);await x.s.prepare(b,{...t,permissions:[]});expect(x.prepare).not.toHaveBeenCalled();expect(x.actions).toEqual(['history','capture','reserve','finish'])});
 it('preserves missing or ineligible sources without a draft write',async()=>{const x=setup(true,false,true);x.snap.mockResolvedValue({...candidate(),c:{ready:false,proposalReady:false,document:{id:'doc'}}} as any);await x.s.prepare(b,t);expect(x.prepare).not.toHaveBeenCalled();expect(x.snap).toHaveBeenCalledTimes(1)});
 it('checks all units before any draft write, even if an authorized unit appears first',async()=>{const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);x.set(a=>({data:a==='history'?{rows:[],canPrepare:true}:{financial:{tables:{consumer_units:[...capture.financial.tables.consumer_units,{id:'other',organization_id:'another-org',customer_id:'customer',status:'ACTIVE'}]}}}}));await expect(x.s.prepare(b,t)).rejects.toThrow('escopo');expect(x.prepare).not.toHaveBeenCalled();expect(x.snap).not.toHaveBeenCalled()});
 it('does not retry an existing uncertain commercial reservation',async()=>{const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);x.set(a=>({data:a==='history'?{rows:[],canPrepare:true}:a==='capture'?{...capture,commercial:[{consumer_unit_id:unit,state:'UNKNOWN'}]}:a==='reserve'?{acquired:true,row:{id}}:{id,state:'INCOMPLETE'}}));await x.s.prepare(b,t);expect(x.prepare).not.toHaveBeenCalled();expect(x.payloads.find(p=>p.p_action==='reserve').p_body.report.missing.join(' ')).toContain('reserva de preparação comercial')});
 it('stops if the unit set changes after creating drafts',async()=>{const x=setup(true,false,true);x.snap.mockResolvedValue(candidate() as any);let count=0;x.set(a=>({data:a==='history'?{rows:[],canPrepare:true}:a==='capture'&&++count===1?capture:{financial:{tables:{consumer_units:[]}}}}));await expect(x.s.prepare(b,t)).rejects.toThrow('conjunto de unidades');expect(x.actions).not.toContain('reserve');expect(x.prepare).toHaveBeenCalledTimes(1)});
 it('replays an existing closing before initiating draft preparation',async()=>{const x=setup(true,false,true);x.set(()=>({data:{rows:[{id}],canPrepare:true}}));await x.s.prepare(b,t);expect(x.prepare).not.toHaveBeenCalled();expect(x.actions).toEqual(['history'])});
});

describe('Approved publication activation',()=>{
 afterEach(()=>{delete process.env.EVA_APPROVED_PUBLICATIONS_ENABLED;delete process.env.EVA_APPROVED_PORTAL_ENABLED});
 it('requires disclosure and routes approval to the atomic function only when both flags are enabled',async()=>{
  process.env.EVA_APPROVED_PUBLICATIONS_ENABLED='true';process.env.EVA_APPROVED_PORTAL_ENABLED='true';
  const rpc=jest.fn(async(..._args:any[])=>({data:{state:'APPROVED'}})),s=new EvaAssistedClosingService({getClient:()=>({rpc})} as any,{get:()=> 'true'} as any,{} as any),body={consumerUnitId:unit,month:b.month,id,decision:'APPROVE',hash:'a'.repeat(64),note:'Fontes e divulgação conferidas pelo usuário.',acknowledge:true};
  await expect(s.decide(body,t)).rejects.toThrow('disponibilização');expect(rpc).not.toHaveBeenCalled();await s.decide({...body,disclose:true},t);expect(rpc).toHaveBeenCalledWith('decide_eva_with_publication',expect.objectContaining({p_body:expect.objectContaining({disclose:true})}));expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_action');
 });
});

describe('isolated contract-memory capture path',()=>{
 afterEach(()=>delete process.env.EVA_CONTRACT_CLOSING_DRAFTS_ENABLED);
 it('uses only the service-only snapshot wrapper when explicitly enabled',async()=>{
  process.env.EVA_CONTRACT_CLOSING_DRAFTS_ENABLED='true';
  const rpc=jest.fn(async()=>({data:{rows:[]}}));
  const s=new EvaAssistedClosingService({getClient:()=>({rpc})} as any,{get:()=> 'true'} as any,{} as any);
  await s.history({consumerUnitId:unit,month:b.month},t);
  expect(rpc).toHaveBeenCalledWith('eva_contract_closing_action',expect.objectContaining({p_action:'history',p_disclose:false,p_org:'org',p_actor:'actor'}));
 });
 it('rejects a memory not present in the captured tenant/unit snapshot before reservation',async()=>{
  process.env.EVA_CONTRACT_CLOSING_DRAFTS_ENABLED='true';const x=setup();
  x.snap.mockResolvedValue({available:true,plan:{fields:[],contractDraft:{memory:{id:'memory',hash:'a'.repeat(64)}}},c:{document:{id:'doc'}}} as any);
  await expect(x.s.prepare(b,t)).rejects.toThrow('memória contratual mudou');expect(x.actions).not.toContain('reserve');expect(x.prepare).not.toHaveBeenCalled();
 });
});

it('activates V3 only through its dedicated flag, preserving legacy comparison tests',async()=>{const v3=invoiceComponentTaxV3 as jest.Mock;v3.mockReturnValue({method:'COMPONENT_TAXES_V3',amount:'100.00',missing:[],observations:[],lines:[],retained:[]});const x=setup(true,true,false,true);x.snap.mockResolvedValueOnce({available:true,plan:{fields:[],operational:{state:'PARTIAL',invoice:{amount:'2.00'},supplier:{amount:'1.00'}}},c:{document:{id:'doc'}}} as any);await x.s.prepare(b,t);expect(v3).toHaveBeenCalledTimes(1);expect(x.payloads.find(p=>p.p_action==='reserve').p_body.report.methodology).toBe('COMPONENT_TAXES_V3');});

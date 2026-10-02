import {OcrAssistantService} from './ocr-assistant.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {TenantContext} from '../../common/interfaces/tenant-context.interface';
function fixture(){
 const tenant:TenantContext={userId:'actor',organizationId:'org',role:'gestor',roleId:'role',email:'test@example.test',permissions:[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_CREATE]};
 const source={doc:{id:'doc',organization_id:'org',consumer_unit_id:'unit',customer_id:'customer',reference_month:'2026-08-01',file_hash:'first'},jobId:'job',raw:{},assessment:{intake:{checks:[]}}};
 const diagnosis={unit:{id:'unit',customerId:'customer',name:'Unit'},month:'2026-08',counts:{blockers:1,reviews:0},findings:[{code:'SUPPLY_GAP',section:'Fornecedor',severity:'BLOCKER',message:'Missing contract'}],measurements:{status:'DRAFT'},costs:{status:'DRAFT'},catalog:[],suppliers:[],feeCoverage:{gaps:[],overlap:false}};
 const query:any={};for(const name of ['select','eq','lt','order','limit'])query[name]=jest.fn(()=>query);
 query.then=(resolve:any)=>Promise.resolve({data:[],error:null}).then(resolve);
 const db:any={getClient:()=>({from:jest.fn(()=>query)})};
 const licenses:any={requireEntitlement:jest.fn(async()=>{})};
 const queue:any={reviewSource:jest.fn(async()=>source)};
 const preparation:any={inspect:jest.fn(async(_input:any,_org:any,capture:any)=>{capture({unit:source.doc});return diagnosis;})};
 const review:any={list:jest.fn(async()=>({fields:[]}))};
 const operations=['first','second'].map(key=>({key,label:key,area:'monthly',preview:jest.fn(async()=>({token:key+'-token',state:'READY',canCreate:true,message:'Ready'})),create:jest.fn(async()=>({inputId:key}))}));
 const service=new OcrAssistantService(db,licenses,queue,preparation,review,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any,{} as any);
 jest.spyOn(service as any,'operations').mockImplementation(()=>operations);
 const body=async()=>({token:(await service.inspect('doc',tenant)).token,operations:['first','second'],acknowledged:true});
 return {service,tenant,source,diagnosis,query,licenses,queue,review,operations,body};
}
describe('OCR assistant safety and partial execution',()=>{
 it('reuses tax-family reads only within one inspection and never caches write previews',async()=>{
  const f=fixture();(f.service as any).operations.mockRestore();const preview=()=>jest.fn(async()=>({token:'token',declarations:['ICMS','PIS','COFINS'].map(code=>({code,state:'READY',canCreate:true,canCreateRevision:true,message:'Ready'}))}));
  const cde=preview(),demand=preview();(f.service as any).cdeTax={preview:cde};(f.service as any).demandTax={preview:demand};
  const run=async(cached:boolean)=>Promise.all((f.service as any).operations('doc',f.tenant,cached).filter((op:any)=>op.key.startsWith('cde-tax-')||op.key.startsWith('demand-tax-')).map((op:any)=>op.preview()));
  await run(true);expect(cde).toHaveBeenCalledTimes(1);expect(demand).toHaveBeenCalledTimes(1);await run(true);expect(cde).toHaveBeenCalledTimes(2);await run(false);expect(cde).toHaveBeenCalledTimes(5);expect(demand).toHaveBeenCalledTimes(5);
 });
 it('requires both document and contract permissions before reading',async()=>{
  const f=fixture();f.tenant.permissions=[P.DOCUMENTS_VIEW];await expect(f.service.inspect('doc',f.tenant)).rejects.toThrow();expect(f.queue.reviewSource).not.toHaveBeenCalled();
 });
 it('fails closed on licences before reading',async()=>{
  const f=fixture();f.licenses.requireEntitlement.mockRejectedValueOnce(new Error('No licence'));await expect(f.service.inspect('doc',f.tenant)).rejects.toThrow('No licence');expect(f.queue.reviewSource).not.toHaveBeenCalled();
 });
 it('scopes validated history by organization, customer, unit and prior month',async()=>{
  const f=fixture();await f.service.inspect('doc',f.tenant);for(const filter of [['organization_id','org'],['customer_id','customer'],['consumer_unit_id','unit'],['status','VALIDATED']])expect(f.query.eq).toHaveBeenCalledWith(...filter);expect(f.query.lt).toHaveBeenCalledWith('month','2026-08');
 });
 it('rejects mismatched document ownership',async()=>{
  const f=fixture();f.diagnosis.unit.customerId='other';await expect(f.service.inspect('doc',f.tenant)).rejects.toThrow('vínculo');
 });
 it('keeps the token stable across read times and rejects changed evidence before writing',async()=>{
  const f=fixture(),body=await f.body();expect((await f.service.inspect('doc',f.tenant)).token).toBe(body.token);f.source.doc.file_hash='changed';await expect(f.service.apply('doc',f.tenant,body)).rejects.toThrow('mudaram');expect(f.operations[0].create).not.toHaveBeenCalled();
 });
 it('preserves existing role restrictions on writes',async()=>{
  const f=fixture(),body=await f.body();f.tenant.role='operador';await expect(f.service.apply('doc',f.tenant,body)).rejects.toThrow('Gestor');expect(f.operations[0].create).not.toHaveBeenCalled();
 });
 it('does not present an old-source confirmation as current',async()=>{
  const f=fixture();f.review.list.mockResolvedValueOnce({fields:[{key:'consumptionTotalKwh',label:'Total',decimal:'100',unit:'kWh',state:'EXTRACTED_REVIEW',sources:['page 1'],sourceHash:'new',history:[{sourceHash:'old',decision:'CONFIRMED',version:1}]}]});expect((await f.service.inspect('doc',f.tenant)).values[0].review).toBeNull();
 });
 it('invalidates the confirmed plan when a field review changes',async()=>{
  const f=fixture(),body=await f.body();f.review.list.mockResolvedValueOnce({fields:[{key:'consumptionTotalKwh',decimal:'100',sources:[],history:[]}]});await expect(f.service.apply('doc',f.tenant,body)).rejects.toThrow('mudaram');expect(f.operations[0].create).not.toHaveBeenCalled();
 });
 it.each([{acknowledged:false},{operations:[]},{operations:['unknown']},{operations:['first','first']},{organizationId:'other'}])('rejects invalid or unconfirmed selections %j',async change=>{
  const f=fixture();await expect(f.service.apply('doc',f.tenant,{...await f.body(),...change})).rejects.toThrow();expect(f.operations[0].create).not.toHaveBeenCalled();
 });
 it('executes selected existing draft writes and never publishes',async()=>{
  const f=fixture(),result=await f.service.apply('doc',f.tenant,await f.body());expect(result.complete).toBe(true);expect(result.canPublish).toBe(false);expect(result.receipts.map(r=>r.state)).toEqual(['SAVED_DRAFT','SAVED_DRAFT']);expect(f.operations[0].create).toHaveBeenCalledWith('first-token');
 });
 it('stops on changed preview rather than silently authorizing new values',async()=>{
  const f=fixture(),body=await f.body();f.operations[0].preview.mockResolvedValueOnce({token:'first-token',state:'READY',canCreate:true,message:'Ready'}).mockResolvedValueOnce({token:'new-token',state:'READY',canCreate:true,message:'Changed'});
  const result=await f.service.apply('doc',f.tenant,body);expect(result.receipts[0].state).toBe('REVIEW_REQUIRED');expect(f.operations[0].create).not.toHaveBeenCalled();expect(f.operations[1].create).not.toHaveBeenCalled();
 });
 it('reports uncertain writes without retrying or losing prior receipts',async()=>{
  const f=fixture(),body=await f.body();f.operations[1].create.mockRejectedValueOnce(new Error('Response lost'));const result=await f.service.apply('doc',f.tenant,body);expect(result.complete).toBe(false);expect(result.receipts.map(r=>r.state)).toEqual(['SAVED_DRAFT','VERIFY_REQUIRED']);expect(f.operations[1].create).toHaveBeenCalledTimes(1);
 });
 it('preserves successful receipts if the final diagnostic read fails',async()=>{
  const f=fixture(),body=await f.body(),original=f.service.inspect.bind(f.service);const inspect=jest.spyOn(f.service,'inspect');inspect.mockImplementationOnce(original).mockRejectedValueOnce(new Error('Final read failed'));const result=await f.service.apply('doc',f.tenant,body);expect(result.complete).toBe(true);expect(result.current).toBeNull();expect(result.receipts.every(r=>r.state==='SAVED_DRAFT')).toBe(true);
 });
});

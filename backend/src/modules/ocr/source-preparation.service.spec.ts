import {createHash} from 'node:crypto';
import {SourcePreparationService} from './source-preparation.service';
import {SOURCE_PREPARATION_FLAG} from './source-preparation-v3';
import {extractPdfText} from './eva-pdf-text.extractor';
jest.mock('./eva-pdf-text.extractor',()=>({extractPdfText:jest.fn()}));
const bytes=Buffer.from('%PDF- synthetic anonymized contract');
const document=()=>({id:'doc',organization_id:'org',customer_id:'client',consumer_unit_id:'unit',document_type:'INVOICE_SUPPLIER',original_filename:'Minuta_Contrato.pdf',file_verified:true,file_hash:createHash('sha256').update(bytes).digest('hex'),file_size_bytes:bytes.length,storage_bucket:'energy-documents-private',file_path:'org/unit/source.pdf'});
const context=()=>({unit:{id:'unit',organization_id:'org',customer_id:'client'},month:'2026-04',period:{start:'2026-04-01',end:'2026-04-30'},captured:{contracts:[{id:'contract',organization_id:'org',customer_id:'client',consumer_unit_id:'unit',contract_type:'ENERGY_PURCHASE',status:'ACTIVE',start_date:'2026-01-01',end_date:'2026-12-31'}]}});
function setup(docs:any[]=[document()]){
 const chain:any={};for(const name of ['select','eq','or'])chain[name]=jest.fn(()=>chain);chain.limit=jest.fn(async()=>({data:docs}));
 const download=jest.fn(async()=>({data:new Blob([new Uint8Array(bytes)])})),from=jest.fn(()=>chain),storageFrom=jest.fn(()=>({download}));
 const db:any={getClient:()=>({from,storage:{from:storageFrom}})};
 (extractPdfText as jest.Mock).mockResolvedValue({sections:[],pageCount:1,ocrRequired:false});
 return {service:new SourcePreparationService(db),chain,from,download,storageFrom};
}
describe('Private original sources without paid extraction',()=>{
 const prior=process.env[SOURCE_PREPARATION_FLAG];
 beforeEach(()=>{process.env[SOURCE_PREPARATION_FLAG]='true';jest.clearAllMocks();});
 afterAll(()=>{if(prior===undefined)delete process.env[SOURCE_PREPARATION_FLAG];else process.env[SOURCE_PREPARATION_FLAG]=prior;});
 it('does not query/download anything while disabled',async()=>{delete process.env[SOURCE_PREPARATION_FLAG];const s=setup();expect(await s.service.inspect(context())).toBeNull();expect(s.from).not.toHaveBeenCalled();expect(s.download).not.toHaveBeenCalled();});
 it('scopes discovery to organization/customer/unit and retains immutable hashes',async()=>{const s=setup(),r=await s.service.inspect(context());expect(s.chain.eq.mock.calls).toEqual(expect.arrayContaining([['organization_id','org'],['customer_id','client'],['consumer_unit_id','unit'],['file_verified',true]]));expect(r?.documents[0]).toMatchObject({documentId:'doc',sourceHash:document().file_hash,link:'CANDIDATE_REQUIRES_REVIEW'});expect(r).toMatchObject({automaticFinancialApproval:false});});
 it.each(['organization_id','customer_id','consumer_unit_id','storage_bucket','file_path','file_hash','file_size_bytes'])('rejects foreign or inconsistent %s before extraction',async key=>{const d:any=document();d[key]=key==='file_size_bytes'?16*1024*1024:'foreign';const s=setup([d]);await expect(s.service.inspect(context())).rejects.toMatchObject({status:503});expect(extractPdfText).not.toHaveBeenCalled();});
 it('uses typed contract documents without depending on their filename and excludes another contract link',async()=>{
  const d:any={...document(),document_type:'CONTRACT_ENERGY',original_filename:'arquivo.pdf',energy_contract_id:'contract'},s=setup([d]);
  expect((await s.service.inspect(context()))?.documents[0].link).toBe('REGISTERED_CONTRACT_DOCUMENT');
  const other=setup([{...d,energy_contract_id:'different-contract'}]);expect((await other.service.inspect(context()))?.documents).toEqual([]);expect(other.download).not.toHaveBeenCalled();
 });
 it('verifies downloaded size and hash before interpreting',async()=>{const d=document();d.file_hash='f'.repeat(64);const s=setup([d]);await expect(s.service.inspect(context())).rejects.toMatchObject({status:503});expect(extractPdfText).not.toHaveBeenCalled();});
 it('keeps a local extraction failure as review, without a paid fallback',async()=>{const s=setup();(extractPdfText as jest.Mock).mockRejectedValue(Error('PDF_INVALID'));const r=await s.service.inspect(context());expect(r?.documents[0].annex.state).toBe('REVIEW');expect(s.download).toHaveBeenCalledTimes(1);});
 it('rechecks scoped metadata/hash on replay and reuses only bounded local text extraction',async()=>{const s=setup();await s.service.inspect(context());await s.service.inspect(context());expect(s.chain.limit).toHaveBeenCalledTimes(2);expect(s.download).toHaveBeenCalledTimes(2);expect(extractPdfText).toHaveBeenCalledTimes(1);});
 it('does not inspect a partial-month or ambiguous supplier contract',async()=>{const s=setup(),c=context();c.captured.contracts[0].start_date='2026-04-02';expect(await s.service.inspect(c)).toMatchObject({state:'REVIEW',documents:[]});expect(s.from).not.toHaveBeenCalled();});
 it('does not select a truncated subset of an excessive document collection',async()=>{const s=setup(Array.from({length:101},()=>document()));await expect(s.service.inspect(context())).rejects.toMatchObject({status:503});expect(s.download).not.toHaveBeenCalled();});
});

describe('Verified supplier invoices for the documented monthly allocation',()=>{
 it('recognizes contract content and reuses verified local text without redundant downloads',async()=>{const d={...document(),reference_month:'2026-04-01'},s=setup([d]);s.chain.maybeSingle=jest.fn(async()=>({data:d}));(extractPdfText as jest.Mock).mockResolvedValue({ocrRequired:false,sections:[{text:'MINUTA DE CONTRATO COMPRADORA VENDEDORA CLAUSULA 1'}]});expect(await s.service.supplierEvidence(context(),'doc',d.file_hash)).toEqual({kind:'CONTRACT',proposal:null});expect(s.download).toHaveBeenCalledTimes(2);expect(await s.service.supplierEvidence(context(),'doc',d.file_hash)).toEqual({kind:'CONTRACT',proposal:null});expect(s.download).toHaveBeenCalledTimes(2);expect(extractPdfText).toHaveBeenCalledTimes(1);});
 it('checks scope, month, metadata and actual bytes without OCR, and bounds replay downloads',async()=>{
  const d={...document(),reference_month:'2026-04-01'},s=setup([d]);s.chain.maybeSingle=jest.fn(async()=>({data:d}));
  expect(await s.service.verifiedSupplierInvoice(context(),'doc',d.file_hash)).toMatchObject({id:'doc',bytesVerified:true,reference_month:'2026-04-01'});
  await s.service.verifiedSupplierInvoice(context(),'doc',d.file_hash);expect(s.download).toHaveBeenCalledTimes(1);expect(extractPdfText).not.toHaveBeenCalled();
  expect(s.chain.eq.mock.calls).toEqual(expect.arrayContaining([['organization_id','org'],['customer_id','client'],['consumer_unit_id','unit'],['id','doc'],['document_type','INVOICE_SUPPLIER']]));
 });
 it.each(['id','organization_id','customer_id','consumer_unit_id','document_type','reference_month','file_hash'])('rejects altered invoice %s before downloading bytes',async key=>{
  const d:any={...document(),reference_month:'2026-04-01'},hash=d.file_hash;d[key]='foreign';const s=setup([d]);s.chain.maybeSingle=jest.fn(async()=>({data:d}));await expect(s.service.verifiedSupplierInvoice(context(),'doc',hash)).rejects.toMatchObject({status:503});expect(s.download).not.toHaveBeenCalled();
 });
});

describe('Distributor installation changes use the scoped immutable registration history',()=>{
 const prior=process.env[SOURCE_PREPARATION_FLAG];
 beforeEach(()=>{process.env[SOURCE_PREPARATION_FLAG]='true';jest.clearAllMocks();});
 afterAll(()=>{if(prior===undefined)delete process.env[SOURCE_PREPARATION_FLAG];else process.env[SOURCE_PREPARATION_FLAG]=prior;});
 function identitySetup(){
  const d={...document(),document_type:'INVOICE_DISTRIBUTOR'},s=setup([d]);
  s.chain.maybeSingle=jest.fn(async()=>({data:d}));s.chain.order=jest.fn(()=>s.chain);
  const record=(code:string)=>({id:'unit',organization_id:'org',customer_id:'client',consumer_unit_number:code});
  s.chain.limit=jest.fn(async()=>({data:[{id:'edit',organization_id:'org',entity_kind:'consumer_units',entity_id:'unit',created_by:'operator',reason:'Confirmed distributor code change',before_record:record('0012345678'),after_record:record('9999999999')}]}));
  (extractPdfText as jest.Mock).mockResolvedValue({ocrRequired:false,sections:[{page:1,issues:[],text:'EMPRESA EXEMPLO LTDA CNPJ 12.345.678/0001-90\nUC: 0012345678\nRUA EXEMPLO 123 CENTRO\nReferencia ABR/2026'}]});
  return s;
 }
 const r={customerName:'Empresa Exemplo LTDA',taxId:'12.345.678/0001-90',unitNumber:'9999999999',address:'Rua Exemplo 123 Centro',month:'2026-04'};
 it('rechecks bytes and uses only an audited code belonging to the same customer and unit',async()=>{
  const s=identitySetup();expect(await s.service.invoiceIdentity('org','client','unit','doc',r)).toMatchObject({state:'MATCH',registrationEditIds:['edit']});
  expect(s.chain.eq.mock.calls).toEqual(expect.arrayContaining([['organization_id','org'],['entity_kind','consumer_units'],['entity_id','unit']]));
 });
 it('shares a single extraction across concurrent requests and native-credit verification, rechecking bytes for every caller',async()=>{const s=identitySetup();let release!:(v:any)=>void;(extractPdfText as jest.Mock).mockImplementation(()=>new Promise(resolve=>{release=resolve;}));const first=s.service.invoiceIdentity('org','client','unit','doc',r),second=s.service.invoiceIdentity('org','client','unit','doc',r);await new Promise(resolve=>setImmediate(resolve));expect(extractPdfText).toHaveBeenCalledTimes(1);expect(extractPdfText).toHaveBeenCalledWith(bytes,20000);release({ocrRequired:false,sections:[{page:1,issues:[],text:'EMPRESA EXEMPLO LTDA CNPJ 12.345.678/0001-90\nUC: 0012345678\nRUA EXEMPLO 123 CENTRO\nReferencia ABR/2026'}]});const results=await Promise.all([first,second]);expect(results.map(v=>v?.state)).toEqual(['MATCH','MATCH']);expect(results[0]).not.toBe(results[1]);expect(s.download).toHaveBeenCalledTimes(2);expect(extractPdfText).toHaveBeenCalledTimes(1);await s.service.invoiceIdentity('org','client','unit','doc',r);expect(s.download).toHaveBeenCalledTimes(3);expect(extractPdfText).toHaveBeenCalledTimes(1);});
 it('does not cache extraction failures or reuse a proof across registration changes',async()=>{const s=identitySetup();(extractPdfText as jest.Mock).mockRejectedValueOnce(new Error('LIMIT'));expect((await s.service.invoiceIdentity('org','client','unit','doc',r))?.state).toBe('REVIEW');expect((await s.service.invoiceIdentity('org','client','unit','doc',r))?.state).toBe('MATCH');expect(extractPdfText).toHaveBeenCalledTimes(2);expect((await s.service.invoiceIdentity('org','client','unit','doc',{...r,month:'2026-05'}))?.state).toBe('MISMATCH');expect(extractPdfText).toHaveBeenCalledTimes(3);});
 it('fails closed if the audit cannot be read and does not accept request-supplied aliases',async()=>{
  const s=identitySetup();s.chain.limit.mockResolvedValue({error:{message:'unavailable'}});
  await expect(s.service.invoiceIdentity('org','client','unit','doc',{...r,auditedUnitNumbers:['0012345678']})).rejects.toMatchObject({status:503});
 });
});

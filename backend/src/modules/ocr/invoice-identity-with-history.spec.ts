import {invoiceIdentityWithHistory} from './invoice-identity-with-history';
import {SOURCE_PREPARATION_FLAG} from './source-preparation-v3';
import {extractPdfText} from './eva-pdf-text.extractor';
jest.mock('./eva-pdf-text.extractor',()=>({extractPdfText:jest.fn()}));
const r={customerName:'Empresa Exemplo LTDA',taxId:'12.345.678/0001-90',unitNumber:'11111',address:'Rua Exemplo 123 Centro',month:'2026-06'};
const text='EMPRESA EXEMPLO LTDA CNPJ 12.345.678/0001-90\nUC: 22222\nRUA EXEMPLO 123 CENTRO\nReferência JUN/2026';
const record=(code:string)=>({id:'unit',organization_id:'org',customer_id:'customer',consumer_unit_number:code});
function setup(){const row={id:'edit',organization_id:'org',entity_kind:'consumer_units',entity_id:'unit',created_by:'actor',reason:'Confirmed distributor code change',before_record:record('22222'),after_record:record('11111')};const rows=[row],q:any={};for(const m of ['select','eq','order'])q[m]=jest.fn(()=>q);q.limit=jest.fn(async()=>({data:rows,error:null}));const db={from:jest.fn(()=>q)};return {row,rows,db,q,read:()=>invoiceIdentityWithHistory(db,Buffer.from('pdf'),'application/pdf',r,'a'.repeat(64),{org:'org',customer:'customer',unit:'unit'})};}
describe('Audited identity at the first read',()=>{
 const prior=process.env[SOURCE_PREPARATION_FLAG];beforeEach(()=>{process.env[SOURCE_PREPARATION_FLAG]='true';(extractPdfText as jest.Mock).mockResolvedValue({sections:[{page:1,text,issues:[]}],ocrRequired:false});});afterAll(()=>{if(prior===undefined)delete process.env[SOURCE_PREPARATION_FLAG];else process.env[SOURCE_PREPARATION_FLAG]=prior;});
 it('accepts only recorded old installation and keeps its audit',async()=>{const s=setup();expect(await s.read()).toMatchObject({state:'MATCH',checks:{unit:'MATCH',taxId:'MATCH',address:'MATCH',period:'MATCH'},registrationEditIds:['edit']});expect(s.q.eq.mock.calls).toEqual([['organization_id','org'],['entity_kind','consumer_units'],['entity_id','unit']]);});
 it.each(['organization_id','entity_id','created_by','reason'])('rejects invalid audit %s',async key=>{const s=setup();(s.row as any)[key]='';expect((await s.read()).state).toBe('MISMATCH');});
 it('preserves other identity mismatches',async()=>{const s=setup();(extractPdfText as jest.Mock).mockResolvedValue({sections:[{page:1,text:text.replace('JUN/2026','JUL/2026'),issues:[]}],ocrRequired:false});expect((await s.read()).state).toBe('MISMATCH');});
 it('rejects caller supplied aliases',async()=>{const s=setup();s.rows.length=0;expect((await invoiceIdentityWithHistory(s.db,Buffer.from('pdf'),'application/pdf',{...r,auditedUnitNumbers:['22222']},'a'.repeat(64),{org:'org',customer:'customer',unit:'unit'})).state).toBe('MISMATCH');});
 it('stops on unavailable audit',async()=>{const s=setup();s.q.limit.mockResolvedValue({data:null,error:{code:'offline'}});await expect(s.read()).rejects.toThrow('histórico auditado');});
});

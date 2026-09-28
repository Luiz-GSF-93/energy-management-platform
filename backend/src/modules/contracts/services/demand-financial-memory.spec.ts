import {loadDemandFinancialMemory as load} from './demand-financial-memory';
import {demandReviewDigest as digest} from '../../ocr/ocr-demand-review.service';
const doc={id:'doc',organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-08-01',file_hash:'hash'},job='job';
function fixture(){
 const field=(decimal:string|null,text=decimal??'')=>({text,decimal,confidence:0.99,pages:[1],spans:[{offset:0,length:1}],issues:[]});
 const operation={source:'tables[3].row[3]',component:'DEMAND_BILLED',role:'CHARGE',issues:[],fields:{unit:field(null,'kW'),quantity:field('234.6400'),grossRate:field('10.70900103'),amount:field('2512.76')}};
 const billed={source:operation.source,description:'Uso Sist. Distr.',period:'UNSPECIFIED',decimal:'234.6400',unit:'kW',state:'BILLED_UNCLASSIFIED'};
 const layout:any={version:'1.2.0',operations:[operation],preparation:{demand:{billed:[billed]}}};
 const key=digest(billed.source),snapshot={format:'ocr-demand-review-v1',layoutVersion:layout.version,jobId:job,document:{id:doc.id,organizationId:doc.organization_id,customerId:doc.customer_id,unitId:doc.consumer_unit_id,month:'2026-08',fileHash:doc.file_hash},field:{...billed,key,label:'Parcela de demanda 1',state:billed.state}};
 const review:any={id:'review',field_key:key,organization_id:'org',document_id:'doc',source_snapshot:snapshot,source_hash:digest(snapshot),version:1,decision:'USED',created_by:'actor',created_at:'2026-09-27'};
 const records:any={document_ocr_demand_reviews:[review],organization_members:[{user_id:'actor',organization_id:'org',display_name:'Ana'}],user_profiles:[]};const calls:any[]=[];let error:any=null;
 const db={from:(table:string)=>{calls.push(table);const q:any={select:()=>q,eq:()=>q,in:()=>q,order:()=>q,limit:async()=>({data:records[table]??[],error:table==='document_ocr_demand_reviews'?error:null}),then:(r:any)=>Promise.resolve({data:records[table]??[],error:null}).then(r)};return q;}};
 return {layout,review,records,db,calls,setError:(e:any)=>error=e};
}
describe('demand memory integrated into preparation',()=>{
 it('captures exact invoice values and the current named classification, without financial import',async()=>{const f=fixture(),r=await load(f.db,doc,job,f.layout);expect(r).toMatchObject({state:'RECONCILED',total:'2512.76',canImport:false,fileHash:'hash',jobId:'job'});expect(r!.rows[0]).toMatchObject({classification:'USED',rate:'10.70900103',review:{id:'review',author:'Ana',version:1}});});
 it('keeps absent reviews pending without inferring classification',async()=>{const f=fixture();f.records.document_ocr_demand_reviews=[];expect(await load(f.db,doc,job,f.layout)).toMatchObject({state:'REVIEW_REQUIRED',total:null,rows:[{classification:'PENDING',review:null}]});});
 it.each(['organization_id','document_id','source_hash'])('rejects mismatched review %s',async key=>{const f=fixture();f.review[key]='foreign';expect((await load(f.db,doc,job,f.layout))!.total).toBeNull();});
 it('rejects altered signed evidence',async()=>{const f=fixture();f.review.source_snapshot.field.decimal='999';expect((await load(f.db,doc,job,f.layout))!.total).toBeNull();});
 it.each(['job','file','unit','period'])('does not reuse evidence after %s changes',async kind=>{const f=fixture(),d={...doc};if(kind==='file')d.file_hash='new';if(kind==='unit')d.consumer_unit_id='new';if(kind==='period')d.reference_month='2026-09-01';expect((await load(f.db,d,kind==='job'?'new':job,f.layout))!.rows[0].review).toBeNull();});
 it('does not reuse classification after current quantity changes',async()=>{const f=fixture();f.layout.preparation.demand.billed[0].decimal='235';expect((await load(f.db,doc,job,f.layout))!.total).toBeNull();});
 it('does not reuse an older confirmation after correction',async()=>{const f=fixture();f.records.document_ocr_demand_reviews.push({...f.review,id:'new',version:2,decision:'NEEDS_CORRECTION'});expect((await load(f.db,doc,job,f.layout))!.rows[0].classification).toBe('PENDING');});
 it('fails closed on duplicate latest versions',async()=>{const f=fixture();f.records.document_ocr_demand_reviews.push({...f.review,id:'duplicate'});expect((await load(f.db,doc,job,f.layout))!.total).toBeNull();});
 it('does not total a divergent or low-confidence amount',async()=>{for(const kind of ['difference','confidence']){const f=fixture();if(kind==='difference')f.layout.operations[0].fields.amount.decimal='2512.77';else f.layout.operations[0].fields.amount.confidence=0.85;expect((await load(f.db,doc,job,f.layout))!.total).toBeNull();}});
 it('omits an empty layout without another database call',async()=>{const f=fixture();f.layout.operations=[];expect(await load(f.db,doc,job,f.layout)).toBeNull();expect(f.calls).toEqual([]);});
 it('rejects unavailable or truncated history',async()=>{const f=fixture();f.setError({});await expect(load(f.db,doc,job,f.layout)).rejects.toThrow('histórico');f.setError(null);f.records.document_ocr_demand_reviews=Array(1001).fill(f.review);await expect(load(f.db,doc,job,f.layout)).rejects.toThrow('histórico');});
 it('requires a known extraction job',async()=>{const f=fixture();await expect(load(f.db,doc,'',f.layout)).rejects.toThrow('Origem');});
});

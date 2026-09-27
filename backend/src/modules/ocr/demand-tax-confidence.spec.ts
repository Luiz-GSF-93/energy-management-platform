import {demandTaxConfidence} from './demand-tax-confidence';
import {electricalField} from './electrical-evidence';
import {OcrDemandReviewService,demandReviewDigest} from './ocr-demand-review.service';
import * as layout from './cpfl-paulista-layout';
const evidence=()=>{const raw={content:'24,00 112,55',pages:[{pageNumber:1,words:[{content:'24,00',span:{offset:0,length:5},confidence:.984},{content:'112,55',span:{offset:6,length:6},confidence:.988}]}]};const input=(offset:number,length:number)=>({content:raw.content.slice(offset,offset+length),spans:[{offset,length}],boundingRegions:[{pageNumber:1}]});return {raw,row:{source:'tables[3].row[4]',issues:[],fields:{icmsAmount:electricalField(raw,{content:''},true),pisAmount:electricalField(raw,input(0,5),true),cofinsAmount:electricalField(raw,input(6,6),true)}} as any};};
describe('Demand tax confidence diagnostics',()=>{
 it('uses verified word confidence without inventing missing ICMS or modifying fields',()=>{const {row}=evidence(),before=JSON.stringify(row),values=demandTaxConfidence(row);expect(values[0]).toMatchObject({confidence:null,method:'UNAVAILABLE'});expect(values[1]).toMatchObject({confidence:.984,method:'MINIMUM_WORD_CONFIDENCE',state:'HIGH_CONFIDENCE'});expect(values[2].confidence).toBe(.988);expect(JSON.stringify(row)).toBe(before);expect(row.fields.pisAmount.confidence).toBeNull();});
 it('keeps lower direct confidence instead of replacing it with higher word confidence',()=>{const {row}=evidence();row.fields.pisAmount.confidence=.45;expect(demandTaxConfidence(row)[1]).toMatchObject({confidence:.45,method:'FIELD_CONFIDENCE',state:'REVIEW_REQUIRED'});});
 it('preserves confidence zero',()=>{const {row}=evidence();row.fields.pisAmount.confidence=0;expect(demandTaxConfidence(row)[1].confidence).toBe(0);});
 it.each([NaN,Infinity,-1,1.01])('does not replace malformed direct confidence %s',value=>{const {row}=evidence();row.fields.pisAmount.confidence=value;expect(demandTaxConfidence(row)[1].confidence).toBeNull();});
 it.each(['UNVERIFIED_SOURCE','INVALID_DECIMAL','NON_BRL_CURRENCY'])('fails closed for field issue %s',issue=>{const {row}=evidence();row.fields.pisAmount.issues.push(issue);expect(demandTaxConfidence(row)[1].confidence).toBeNull();});
 it.each(['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'])('fails closed for row ambiguity %s',issue=>{const {row}=evidence();row.issues.push(issue);expect(demandTaxConfidence(row).every(f=>f.confidence===null)).toBe(true);});
 it('requires complete verified words and pages/spans',()=>{for(const change of [(f:any)=>f.transcription.state='UNAVAILABLE',(f:any)=>f.transcription.wordCount=0,(f:any)=>f.pages=[],(f:any)=>f.spans=[]]){const {row}=evidence();change(row.fields.pisAmount);expect(demandTaxConfidence(row)[1].confidence).toBeNull();}});
 it('keeps 85 percent in review, not high confidence',()=>{const {row}=evidence();row.fields.pisAmount.transcription.confidence=.85;expect(demandTaxConfidence(row)[1].state).toBe('REVIEW_REQUIRED');});
 it('rejects incomplete word coverage through the source verifier',()=>{const {raw,row}=evidence();raw.pages[0].words=[];row.fields.pisAmount=electricalField(raw,{content:'24,00',spans:[{offset:0,length:5}],boundingRegions:[{pageNumber:1}]},true);expect(demandTaxConfidence(row)[1].confidence).toBeNull();});
 it('adds diagnostics outside the signed snapshot and preserves its exact digest',async()=>{
  const {row}=evidence(),billed={source:row.source,decimal:'265.3600',unit:'kW',state:'BILLED_UNCLASSIFIED',taxReview:[{confidence:null}]};
  const spy=jest.spyOn(layout,'extractCpflPaulistaLayout').mockReturnValue({version:'cpfl-paulista-a@1.2.0',operations:[row],preparation:{demand:{billed:[billed]}}} as any);
  try{const source={raw:{},jobId:'job',doc:{id:'doc',organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',reference_month:'2026-08-01',file_hash:'hash'}};
   const service=new OcrDemandReviewService({} as any,{reviewSource:jest.fn(async()=>source)} as any),context=await (service as any).context('org','doc');
   const field={...billed,key:demandReviewDigest(row.source),label:'Parcela de demanda 1',state:billed.state};
   const snapshot={format:'ocr-demand-review-v1',layoutVersion:'cpfl-paulista-a@1.2.0',jobId:'job',document:{id:'doc',organizationId:'org',customerId:'customer',unitId:'unit',month:'2026-08',fileHash:'hash'},field};
   expect(context.fields[0].snapshot).toEqual(snapshot);expect(context.fields[0].sourceHash).toBe(demandReviewDigest(snapshot));expect(context.taxDiagnostics[0].fields[1].confidence).toBe(.984);expect(context.fields[0].field).not.toHaveProperty('taxDiagnostics');
  }finally{spy.mockRestore();}
 });
});

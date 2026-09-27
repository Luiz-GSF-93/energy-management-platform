import {cdeConfidenceDiagnostics} from './cde-confidence';
import {electricalField} from './electrical-evidence';
import {cdeParameterCandidates} from './cde-parameter-candidates';
function fixture(low=.299){
 const raw:any={content:'',stringIndexType:'utf16CodeUnit',pages:[{pageNumber:1,words:[]}]};const inputs:any={};
 const values:any={description:'CDE Escassez Hídrica Ponta AGO/26',unit:'kWh',quantity:'11.378,6400',grossRate:'0,00502609',amount:'57,19',icmsAmount:'10,29',pisAmount:'0,48',cofinsAmount:'2,27'};
 for(const [key,value] of Object.entries(values) as [string,string][]){const offset=raw.content.length;raw.content+=value+'\n';inputs[key]={content:value,spans:[{offset,length:value.length}],boundingRegions:[{pageNumber:1}]};for(const m of value.matchAll(/\S+/g))raw.pages[0].words.push({content:m[0],span:{offset:offset+m.index!,length:m[0].length},confidence:m[0]==='Hídrica'?low:key==='pisAmount'?.984:.992});}
 const fields=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,electricalField(raw,input,!['description','unit'].includes(key))]));
 return {raw,row:{source:'tables[0].row[1]',row:1,role:'CHARGE' as const,component:'CDE_WATER_SCARCITY',period:'PEAK',fields,issues:[],arithmetic:{state:'MATCH',differenceCents:'0'}}};
}
describe('CDE confidence diagnostics',()=>{
 it.each([.299,.246])('locates the uncertain word while preserving numeric confidence (%s)',low=>{const {raw,row}=fixture(low),before=JSON.stringify({raw,row});const d=cdeConfidenceDiagnostics(raw,row);expect(d.numericConfidence).toBe(.984);expect(d.reviewFields).toEqual(['Descrição']);expect(d.descriptionWords.filter(w=>w.confidence<=.85)).toEqual([{text:'Hídrica',confidence:low,page:1,offset:13}]);expect(d.fields[0]).toMatchObject({confidence:low,method:'MINIMUM_WORD_CONFIDENCE',state:'REVIEW_REQUIRED'});expect(JSON.stringify({raw,row})).toBe(before);expect(cdeParameterCandidates([row])[0].ready).toBe(false);});
 it('does not replace low field confidence with higher word confidence',()=>{const {raw,row}=fixture(.99);row.fields.description.confidence=.4;row.fields.description.issues=['CONFIDENCE_BELOW_45'];expect(cdeConfidenceDiagnostics(raw,row).fields[0]).toMatchObject({confidence:.4,method:'FIELD_CONFIDENCE',state:'REVIEW_REQUIRED'});});
 it('keeps missing and unverified numeric evidence unknown',()=>{const {raw,row}=fixture();row.fields.icmsAmount.issues.push('UNVERIFIED_SOURCE');const d=cdeConfidenceDiagnostics(raw,row);expect(d.numericConfidence).toBeNull();expect(d.reviewFields).toEqual(['Descrição','ICMS']);expect(cdeConfidenceDiagnostics({},undefined).descriptionWords).toEqual([]);});
 it('rejects wrong source text, overlapping words and wrong pages for word details',()=>{for(const mutate of [(r:any)=>r.content=r.content.replace('Hídrica','Hidrica'),(r:any)=>r.pages[0].words.push(r.pages[0].words[0]),(r:any)=>r.pages[0].pageNumber=2]){const {raw,row}=fixture();mutate(raw);expect(cdeConfidenceDiagnostics(raw,row).descriptionWords).toEqual([]);}});
 it('does not turn high confidence into approval and preserves threshold',()=>{const {raw,row}=fixture(.99);row.fields.amount.transcription!.confidence=.85;expect(cdeConfidenceDiagnostics(raw,row).reviewFields).toEqual(['Valor da operação']);expect(cdeParameterCandidates([row])[0].ready).toBe(false);});
});

import {transcriptionEvidence as extract} from './transcription-evidence';
import {electricalField} from './electrical-evidence';
function fixture(){const raw:any={content:'Energia 12,50',pages:[{pageNumber:1,words:[{content:'Energia',span:{offset:0,length:7},confidence:0.98},{content:'12,50',span:{offset:8,length:5},confidence:0.8}]}]};const input:any={content:raw.content,spans:[{offset:0,length:13}],boundingRegions:[{pageNumber:1}]};return {raw,input};}
describe('word transcription provenance',()=>{
 it('uses minimum, never average, and keeps semantic confidence absent',()=>{const {raw,input}=fixture();expect(extract(raw,input)).toMatchObject({confidence:0.8,wordCount:2,state:'VERIFIED_WORDS'});const f=electricalField(raw,input);expect(f.confidence).toBeNull();expect(f.issues).toContain('MISSING_CONFIDENCE');});
 it('retains existing field confidence independently',()=>{const {raw,input}=fixture();input.confidence=0.99;expect(electricalField(raw,input)).toMatchObject({confidence:0.99,transcription:{confidence:0.8}});});
 it.each([null,-1,1.1,NaN])('rejects missing/invalid word confidence %s',v=>{const {raw,input}=fixture();raw.pages[0].words[1].confidence=v;expect(extract(raw,input).confidence).toBeNull();});
 it('preserves zero confidence',()=>{const {raw,input}=fixture();raw.pages[0].words[1].confidence=0;expect(extract(raw,input).confidence).toBe(0);});
 it('rejects missing word coverage',()=>{const {raw,input}=fixture();raw.pages[0].words.pop();expect(extract(raw,input).confidence).toBeNull();});
 it('rejects changed word text',()=>{const {raw,input}=fixture();raw.pages[0].words[1].content='12,60';expect(extract(raw,input).confidence).toBeNull();});
 it('rejects source mismatch',()=>{const {raw,input}=fixture();input.content='Energia 12,60';expect(extract(raw,input).confidence).toBeNull();});
 it('rejects wrong page',()=>{const {raw,input}=fixture();input.boundingRegions=[{pageNumber:2}];expect(extract(raw,input).confidence).toBeNull();});
 it('rejects repeated page or overlapping words',()=>{const {raw,input}=fixture();raw.pages.push(raw.pages[0]);expect(extract(raw,input).confidence).toBeNull();raw.pages.pop();raw.pages[0].words.push(raw.pages[0].words[0]);expect(extract(raw,input).confidence).toBeNull();});
 it('rejects partial words',()=>{const {raw,input}=fixture();input.content='nergia';input.spans=[{offset:1,length:6}];expect(extract(raw,input).confidence).toBeNull();});
 it('rejects overlapping field spans',()=>{const {raw,input}=fixture();input.spans.push(input.spans[0]);expect(extract(raw,input).confidence).toBeNull();});
 it('does not confuse Unicode index modes',()=>{const {raw,input}=fixture();raw.content+='😀';expect(extract(raw,input).confidence).toBeNull();raw.stringIndexType='utf16CodeUnit';expect(extract(raw,input).confidence).toBe(0.8);});
 it('accepts separated verified spans without including intermediate words',()=>{const {raw,input}=fixture();input.spans=[{offset:0,length:7},{offset:8,length:5}];expect(extract(raw,input).confidence).toBe(0.8);});
 it('has no evidence for blank or absent input',()=>{expect(extract(null,null).confidence).toBeNull();const {raw,input}=fixture();input.content=' ';expect(extract(raw,input).confidence).toBeNull();});
});

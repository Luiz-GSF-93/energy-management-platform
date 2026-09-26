/** Word-level transcription evidence is not semantic field confidence or approval. */
export type TranscriptionEvidence={confidence:number|null;wordCount:number;state:'VERIFIED_WORDS'|'UNAVAILABLE';method:'MINIMUM_WORD_CONFIDENCE'};
const unavailable=():TranscriptionEvidence=>({confidence:null,wordCount:0,state:'UNAVAILABLE',method:'MINIMUM_WORD_CONFIDENCE'});
const arr=(v:any):any[]=>Array.isArray(v)?v:[];
export function transcriptionEvidence(raw:any,input:any):TranscriptionEvidence{
 const content=typeof raw?.content==='string'?raw.content:'';const value=typeof input?.content==='string'?input.content:'';
 if(!value.trim()||content.length>1000000)return unavailable();
 // Avoid interpreting grapheme/code-point offsets as UTF-16 when indexing differs.
 if(raw?.stringIndexType!=='utf16CodeUnit'&&/[\uD800-\uDFFF\u0300-\u036f]/.test(content))return unavailable();
 const spans=arr(input?.spans);const pages=arr(input?.boundingRegions).map(r=>r?.pageNumber);
 if(!spans.length||!pages.length||spans.length>100)return unavailable();
 const valid=(s:any)=>Number.isSafeInteger(s?.offset)&&s.offset>=0&&Number.isSafeInteger(s.length)&&s.length>0&&s.offset+s.length<=content.length;
 if(!spans.every(valid))return unavailable();
 const sorted=[...spans].sort((a,b)=>a.offset-b.offset);
 if(sorted.some((s,i)=>i>0&&s.offset<sorted[i-1].offset+sorted[i-1].length))return unavailable();
 if(spans.map(s=>content.slice(s.offset,s.offset+s.length)).join(' ').replace(/\s/g,'')!==value.replace(/\s/g,''))return unavailable();
 const sourcePages=arr(raw?.pages).filter(p=>pages.includes(p?.pageNumber));
 if(new Set(sourcePages.map(p=>p.pageNumber)).size!==new Set(pages).size||sourcePages.length!==new Set(pages).size)return unavailable();
 const all=sourcePages.flatMap(p=>arr(p.words));if(all.length>50000)return unavailable();
 const selected=all.filter(w=>valid(w?.span)&&spans.some(s=>w.span.offset<s.offset+s.length&&w.span.offset+w.span.length>s.offset));
 if(!selected.length||selected.length>5000)return unavailable();
 for(const w of selected){const s=w.span;if(!spans.some(f=>s.offset>=f.offset&&s.offset+s.length<=f.offset+f.length)||typeof w.confidence!=='number'||!Number.isFinite(w.confidence)||w.confidence<0||w.confidence>1||typeof w.content!=='string'||content.slice(s.offset,s.offset+s.length)!==w.content)return unavailable();}
 selected.sort((a,b)=>a.span.offset-b.span.offset);
 if(selected.some((w,i)=>i>0&&w.span.offset<selected[i-1].span.offset+selected[i-1].span.length))return unavailable();
 // Every non-whitespace source character must be covered by a verified word.
 for(const s of spans){let cursor=s.offset;for(const w of selected.filter(w=>w.span.offset>=s.offset&&w.span.offset<s.offset+s.length)){if(content.slice(cursor,w.span.offset).trim())return unavailable();cursor=w.span.offset+w.span.length;}if(content.slice(cursor,s.offset+s.length).trim())return unavailable();}
 return {confidence:Math.min(...selected.map(w=>w.confidence)),wordCount:selected.length,state:'VERIFIED_WORDS',method:'MINIMUM_WORD_CONFIDENCE'};
}

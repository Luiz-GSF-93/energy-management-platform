import type {CpflOperation} from './cpfl-paulista-layout';
const months=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];
function confidence(f:CpflOperation['fields'][string]|undefined){
 if(!f?.text.trim()||!f.pages.length||!f.spans.length||f.issues.some(i=>i!=='MISSING_CONFIDENCE'))return null;
 const v=f.confidence===null&&f.transcription?.state==='VERIFIED_WORDS'&&f.transcription.wordCount>0?f.transcription.confidence:f.confidence;
 return typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:null;
}
/** A single, positive, current-month CIP line; never infer tax exemptions from empty cells. */
export function cipCostCandidate(rows:CpflOperation[],month:string){
 const matches=rows.filter(r=>r.component==='PUBLIC_LIGHTING'),r=matches[0];
 const description=r?.fields.description,amount=r?.fields.amount;
 const result={source:r?.source??null,description:description?.text??null,amount:amount?.decimal??null,descriptionConfidence:confidence(description),amountConfidence:confidence(amount),pages:amount?.pages??[]};
 const blocked=(reason:string)=>({...result,ready:false,reason});
 if(!/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(month))return blocked('Competência inválida.');
 if(matches.length!==1)return blocked('É necessária uma única cobrança de iluminação pública nesta fatura.');
 if(r.role!=='CHARGE'||!r.source||rows.filter(x=>x.source===r.source).length!==1||r.issues.some(i=>['MERGED_OR_DUPLICATE_CELL','UNMAPPED_COLUMN'].includes(i)))return blocked('Origem da linha de iluminação pública ambígua.');
 const text=(description?.text??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().trim();
 if(!/^(CONTRIBUICAO CUSTEIO IP(?:-CIP)?|CIP|COSIP)\b/.test(text))return blocked('Confira a descrição da contribuição de iluminação pública.');
 const refs=[...text.matchAll(/\b(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\/(\d{4}|\d{2})\b/g)];
 if(refs.length!==1||((refs[0][2].length===2?'20':'')+refs[0][2]+'-'+String(months.indexOf(refs[0][1])+1).padStart(2,'0'))!==month)return blocked('A competência da linha CIP precisa coincidir com a fatura.');
 if(result.descriptionConfidence===null||result.amountConfidence===null||result.descriptionConfidence<=.85||result.amountConfidence<=.85)return blocked('Descrição e valor da CIP precisam de confiança acima de 85% e evidência verificável.');
 if(!/^(0|[1-9][0-9]{0,11})[.]\d{2}$/.test(result.amount??'')||BigInt(result.amount!.replace('.',''))<=0n)return blocked('Valor positivo da CIP em centavos não identificado.');
 return {...result,ready:true,reason:'CIP disponível para rascunho ACL. Tratamento tributário e completude dos custos permanecem pendentes.'};
}

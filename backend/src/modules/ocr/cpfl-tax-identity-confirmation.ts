/** Explicit human review of a complete CPFL CNPJ. Never changes OCR confidence or auto-approves. */
export function cpflTaxIdentityAttestation(preview:any,check:any){
 if(preview.layoutId!=='cpfl-paulista-a'||preview.registrationAvailable!==true||preview.duplicate!==false||check.key!=='taxId'||check.comparison!=='EQUAL'||check.state!=='REVIEW')return null;
 const digits=(v:unknown)=>typeof v==='string'&&/^(?:\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/.test(v.trim())?v.replace(/\D/g,''):'';
 const registered=digits(check.expected);
 if(!registered||/^(\d)\1{13}$/.test(registered))return null;
 const digit=(base:string)=>{let weight=base.length-7;const sum=[...base].reduce((s,n)=>{const value=s+Number(n)*weight;weight=weight===2?9:weight-1;return value;},0),rest=sum%11;return String(rest<2?0:11-rest);};
 if(digit(registered.slice(0,12))!==registered[12]||digit(registered.slice(0,13))!==registered[13])return null;
 const sourced=(c:any)=>Array.isArray(c?.pages)&&c.pages.length>0&&c.pages.every((p:any)=>Number.isInteger(p)&&p>0)&&typeof c.source==='string'&&!!c.source.trim()&&Array.isArray(c.issues);
 const allowed=['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW','CONFIDENCE_BELOW_45'];
 const tax=check.candidates;
 if(!Array.isArray(tax)||!tax.length||!tax.every((c:any)=>sourced(c)&&digits(c.text)===registered&&c.issues.every((i:string)=>allowed.includes(i))&&(c.confidence===null||typeof c.confidence==='number'&&Number.isFinite(c.confidence)&&c.confidence>=0&&c.confidence<=1)&&(!c.issues.includes('CONFIDENCE_BELOW_45')||typeof c.confidence==='number'&&c.confidence<0.45))||!tax.some((c:any)=>c.issues.includes('CONFIDENCE_BELOW_45')))return null;
 const anchors=Object.fromEntries(['customer','unit','address','period','market'].map(key=>[key,preview.checks.find((c:any)=>c.key===key)]));
 if(!Object.values(anchors).every((a:any)=>a?.comparison==='EQUAL'&&['MATCH','REVIEW'].includes(a.state)&&Array.isArray(a.candidates)&&a.candidates.length>0&&a.candidates.every((c:any)=>sourced(c)&&c.issues.every((i:string)=>['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW'].includes(i)))))return null;
 return {policy:'cpfl-complete-tax-id-attestation-v1',mode:'COMPLETE_TAX_ID_LOW_CONFIDENCE',registeredTaxId:registered,anchors};
}

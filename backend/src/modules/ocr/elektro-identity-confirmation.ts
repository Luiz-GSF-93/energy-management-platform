/** Human attestation policy, never automatic identity approval. */
export function elektroIdentityAttestation(preview:any,check:any){
 if(preview.layoutId!=='neoenergia-elektro-verde'||!preview.registrationAvailable||preview.duplicate)return null;
 const get=(key:string)=>preview.checks.find((c:any)=>c.key===key),tax=get('taxId'),unit=get('unit'),address=get('address'),period=get('period'),name=get('customer'),market=get('market');
 const clean=(c:any)=>c?.candidates?.length>0&&c.candidates.every((f:any)=>f.pages.length>0&&f.issues.every((i:string)=>['MISSING_CONFIDENCE','CONFIDENCE_REQUIRES_REVIEW'].includes(i)));
 if(tax?.comparison!=='PARTIAL'||!clean(tax)||tax.candidates.length!==1||![unit,address,period].every(c=>c?.comparison==='EQUAL'&&clean(c))||!clean(name))return null;
 const matched=/^CNPJ\s*[-:]?\s*\*{8}\s*(\d{6})\s*$/i.exec(tax.candidates[0].text),registeredTaxId=String(tax.expected??'').replace(/\D/g,'');
 if(!matched||registeredTaxId.length!==14||!registeredTaxId.endsWith(matched[1]))return null;
 let mode:string|null=null;
 if(check.key==='taxId')mode='MASKED_TAX_ID';
 if(check.key==='customer'&&check.comparison==='DIFFERENT'&&check.candidates.length===1)mode='NAME_EQUIVALENCE';
 if(check.key==='market'&&check.comparison==='UNKNOWN'&&['ACL','ACR'].includes(check.expected)&&check.candidates.every((c:any)=>!/(?:\bACL\b|\bACR\b|LIVRE|CATIVO|REGULADA)/i.test(c.text)))mode='REGISTERED_MARKET';
 if(!mode)return null;
 return {policy:'elektro-identity-attestation-v1',mode,visibleSuffix:matched[1],registeredTaxId,unit:unit.expected,address:address.expected,month:period.expected,printedName:name.candidates[0].text,registeredName:name.expected,market:market.expected,anchors:{unit:unit.candidates,address:address.candidates,period:period.candidates,tax:tax.candidates}};
}

import {companyTaxIdentity} from './eva-preparation-policy';

export type SupplierUnitIdentity={unitNumber:string;address:string;aliases?:string[];auditedAddresses?:string[]};
const compact=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');

/** DANFE cells can put CEP/bairro before the street. Compare a complete street
 * line, preserving its number and complement, instead of searching a flattened
 * address substring (which also confuses 123 with 1234). */
export function supplierAddressMatches(text:string,address:string){
 // Preserve complete literal matches already supported by older XML/PDF
 // layouts, but never accept a prefix of a longer street number/postcode.
 const literal=compact(address??''),body=compact(text);
 if(literal.length>=12)for(let at=body.indexOf(literal);at>=0;at=body.indexOf(literal,at+1))if(!/\d$/.test(literal)||!/[0-9]/.test(body[at+literal.length]??''))return true;
 const normalize=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 const postal=(v:string)=>[...normalize(v).matchAll(/\b\d{5}[- ]?\d{3}\b/g)].map(m=>m[0].replace(/\D/g,''));
 const street=(v:string)=>normalize(v).replace(/(?:\bCEP\s*:?\s*)?\b\d{5}[- ]?\d{3}\b\s*$/,'').replace(/[.,]/g,' ').replace(/\s+/g,' ').trim().replace(/\s+CENTRO$/,'').replace(/^(?:AVENIDA|AV)\s+/,'AVENIDA ').replace(/^(?:RUA|R)\s+/,'RUA ');
 const expected=street(address??''),zip=postal(address??'');
 if(!/^(?:RUA|AVENIDA)\s/.test(expected)||compact(expected).length<12||!/[0-9]/.test(expected))return false;
 if(zip.length&&(!postal(text).length||!zip.every(z=>postal(text).includes(z))))return false;
 return text.split(/[\r\n]+/).some(line=>street(line)===expected);
}

/** Fiscal recipient and supplied installation are separate identities. An exact,
 * audited installation code may prove delivery when the fiscal address is the HQ.
 * A conflicting explicit code cannot be overridden by an address match. */
export function supplierUnitIdentity(taxId:string,recipientTaxId:string,unit:SupplierUnitIdentity,codes:string[],addresses:string[],period:boolean){
 const known=new Set([unit.unitNumber,...unit.aliases??[]].map(compact).filter(Boolean));
 const found=[...new Set(codes.map(compact).filter(Boolean))];
 const conflict=found.some(code=>!known.has(code));
 const unitMatch=found.length>0&&!conflict;
 const addressMatch=[unit.address,...unit.auditedAddresses??[]].some(address=>{
  return addresses.some(value=>supplierAddressMatches(value,address??''));
 });
 // SAME_ROOT still requires independent installation and competence evidence.
 const installationMatch=!conflict&&(unitMatch||addressMatch);
 const tax=companyTaxIdentity(taxId,[recipientTaxId],{unit:unitMatch,address:addressMatch,period});
 const accepted=tax.relation==='EXACT'||tax.relation==='SAME_ROOT'&&period&&installationMatch;
 const taxIdentity=tax.relation==='SAME_ROOT'?{...tax,accepted,reason:accepted?
  'Destinatário fiscal de mesma raiz de CNPJ; instalação comprovada por '+(unitMatch?'UC atual ou histórica auditada':'endereço da unidade')+'. CNPJ completo e endereço fiscal originais preservados.':
  'A raiz do CNPJ é comum, mas falta comprovar uma instalação e competência inequívocas.'}:tax;
 return {matched:period&&installationMatch&&taxIdentity.accepted,unitMatch,addressMatch,conflict,codes:found,taxIdentity,matchedBy:unitMatch?'UNIT_CODE':addressMatch?'UNIT_ADDRESS':null};
}

export function supplierUnitCodes(text:string){
 return [...text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().matchAll(/(?:\bUC\b|INSTALACAO|UNIDADE CONSUMIDORA)\s*[:.]?\s*([0-9][0-9.-]{4,31})\b/g)].map(match=>match[1]);
}

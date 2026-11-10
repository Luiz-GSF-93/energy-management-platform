import {companyTaxIdentity} from './eva-preparation-policy';

export type SupplierUnitIdentity={unitNumber:string;address:string;aliases?:string[];auditedAddresses?:string[]};
const compact=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');

/** Fiscal recipient and supplied installation are separate identities. An exact,
 * audited installation code may prove delivery when the fiscal address is the HQ.
 * A conflicting explicit code cannot be overridden by an address match. */
export function supplierUnitIdentity(taxId:string,recipientTaxId:string,unit:SupplierUnitIdentity,codes:string[],addresses:string[],period:boolean){
 const known=new Set([unit.unitNumber,...unit.aliases??[]].map(compact).filter(Boolean));
 const found=[...new Set(codes.map(compact).filter(Boolean))];
 const conflict=found.some(code=>!known.has(code));
 const unitMatch=found.length>0&&!conflict;
 const addressMatch=[unit.address,...unit.auditedAddresses??[]].some(address=>{
  const expected=compact(address??'');return expected.length>=12&&addresses.some(value=>compact(value).includes(expected));
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

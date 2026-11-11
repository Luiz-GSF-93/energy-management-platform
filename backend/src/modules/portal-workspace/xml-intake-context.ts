import {createHash} from 'node:crypto';
import {readFiscalXml,xmlUnitMatch,fiscalSupplyMonths} from '../ocr/fiscal-xml';
import {identityRegistration} from './automatic-intake-triage';
import {IntakeCustomer,IntakeUnit} from './automatic-intake-context';

/** Fiscal nodes are not OCR pages. The same immutable decision protocol is
 * reused, without manufacturing a page number or model confidence. */
export function xmlIntakeDiagnostic(xml:ReturnType<typeof readFiscalXml>,c:IntakeCustomer,u:IntakeUnit,month:string){
 const f=xml.fiscal,p=xmlUnitMatch(f,c,u,month),compact=(s:string)=>s.toUpperCase().replace(/[^A-Z0-9]/g,'');
 const known=[u.consumer_unit_number,...u.aliases??[]].map(compact),unknown=f.unitCodes.filter(v=>!known.includes(compact(v)));
 const sameRoot=p.taxIdentity.relation==='SAME_ROOT',taxMatch=p.taxIdentity.accepted||sameRoot;
 const field=(key:string,label:string,expected:string,found:string[],status:string)=>({key,label,expected,found,status,pages:[],reason:'Campo estruturado do XML original. Assinatura e situação fiscal exigem conferência própria.'});
 const fields=[field('taxId','CNPJ do destinatário',c.document,[f.recipient.taxId],taxMatch?'MATCH':'MISMATCH'),field('address','Endereço da unidade',u.address,[f.recipient.address],p.addressMatch?'MATCH':'MISMATCH'),field('unit','UC / instalação',u.consumer_unit_number,f.unitCodes,p.unitMatch?'MATCH':f.unitCodes.length?'MISMATCH':'INCONCLUSIVE'),field('period','Competência de fornecimento',month,fiscalSupplyMonths(f),p.period?'MATCH':'INCONCLUSIVE')];
 if(f.kind==='INVOICE_SUPPLIER'&&f.unitCodes.length===0)Object.assign(fields[2],{required:false,label:'UC (opcional na NF do fornecedor)',reason:'A NF será vinculada por CNPJ e endereço, com a competência conferida. A ausência de UC não bloqueia; divergência de endereço pode ser confirmada e justificada pelo operador.'});
 const eligible=taxMatch&&p.addressMatch&&p.period&&unknown.length===1;
 const result={version:'intake-identity-triage-1',fileHash:f.sourceHash,registration:identityRegistration(c,u,month),fields,sourcePages:[],sourceKind:'XML',read:true,...(sameRoot?{taxIdentity:p.taxIdentity}:{}),documentType:f.kind,action:eligible?'CONTINUE_JUSTIFIED':'REVIEW',unitCode:eligible?compact(unknown[0]):null};
 return {...result,fingerprint:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
}

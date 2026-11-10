import {companyTaxIdentity} from '../ocr/eva-preparation-policy';
import {createHash} from 'node:crypto';
import {invoiceAddressMatches,invoiceIdentityText} from '../ocr/invoice-identity-preflight';
import {supplierDocumentKind,supplierRecipientText} from '../ocr/supplier-invoice-proposal';
import {intakeMonthCandidates,IntakePage,IntakeCustomer,IntakeUnit} from './automatic-intake-context';
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const compact=(s:string)=>norm(s).replace(/[^A-Z0-9]/g,'');
type Field={key:string;label:string;status:'MATCH'|'MISMATCH'|'INCONCLUSIVE';expected:string;found:string[];pages:number[];reason:string};
export function identityRegistration(c:IntakeCustomer,u:IntakeUnit,month:string){return {customerId:c.id,unitId:u.id,taxId:c.document,address:u.address,unitNumber:u.consumer_unit_number,month};}
/** Content evidence is separated from a human decision. Missing text is never a mismatch.
 * Only the explicitly selected, authorized target can be rejected automatically. */
export function intakeIdentityDiagnostic(pages:IntakePage[],c:IntakeCustomer,u:IntakeUnit,hash:string,month:string,raw?:any){
 if(u.customer_id!==c.id||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||!/^[a-f0-9]{64}$/.test(hash))return null;
 const text=pages.map(p=>p.text).join('\n'),t=norm(text),supplier=supplierDocumentKind(text)==='INVOICE';
 let recipient=supplier?supplierRecipientText(text):'';
 if(!supplier){
  // CPFL's recipient strip is distinct from issuer and bank details.
  const before=t.split(/NOTA FISCAL N|DESCRICAO DA OPERACAO/)[0],name=norm(c.company_name);
  const start=before.indexOf(name);recipient=start>=0?before.slice(start):before;
 }
 const ids=[...recipient.matchAll(/\b[0-9A-Z]{2}\.?[0-9A-Z]{3}\.?[0-9A-Z]{3}\s*\/?\s*[0-9A-Z]{4}-?[0-9]{2}\b/g)].map(m=>compact(m[0]));
 const explicitTax=!supplier?[...t.matchAll(/INSC\.?\s*EST[^\n]*?CNPJ\s*:\s*([0-9A-Z./-]+)/g)].map(m=>compact(m[1])):[];
 const taxes=[...new Set(explicitTax.length?explicitTax:ids)];
 const tax=compact(c.document),addressMatch=invoiceAddressMatches(recipient,u.address);
 const addressLines=recipient.split('\n').map(s=>s.trim()).filter(s=>/^(?:RUA|R\.|AVENIDA|AV\.?\s|RDV\s|RODOVIA\s|ESTRADA\s|CRT\s)/.test(norm(s))&&/(?:\d|S\s*\/\s*N)/.test(s));
 // Address mismatch requires an actual, unique printed street. Never use labels alone.
 const addresses=addressMatch?[u.address]:[...new Set(addressLines)];
 const codes=[...t.matchAll(/(?:NUMERO\s+DA\s+INSTALACAO|CODIGO\s+DA\s+INSTALACAO|UNIDADE\s+CONSUMIDORA|\bUC\b|\bINSTALACAO)\s*(?:N[º°.]?|:)?\s*([0-9][0-9.-]{4,30})\b/g)].map(m=>compact(m[1]));
 const uc=[...new Set(codes)],accepted=new Set([u.consumer_unit_number,...u.aliases??[]].map(compact)),unknown=uc.filter(v=>!accepted.has(v));
 const months=intakeMonthCandidates(text),proof=invoiceIdentityText(text,{customerName:c.company_name,taxId:c.document,unitNumber:u.consumer_unit_number,address:u.address,month,auditedUnitNumbers:u.aliases});
 const taxIdentity=companyTaxIdentity(c.document,taxes,{unit:uc.length>0&&unknown.length===0,address:addressMatch,period:months.length===1&&months[0]===month});
 const foundPages=(values:string[])=>pages.filter(p=>values.some(v=>compact(p.text).includes(compact(v)))).map(p=>p.page);
 const field=(key:string,label:string,expected:string,found:string[],status:Field['status'],reason:string):Field=>({key,label,expected,found:found.slice(0,8),status,pages:foundPages(found),reason});
 const fields:Field[]=[
  field('taxId','CNPJ do destinatário',c.document,taxes,taxes.length===1?(taxes[0]===tax||taxIdentity.relation==='SAME_ROOT'?'MATCH':'MISMATCH'):'INCONCLUSIVE',taxIdentity.relation==='SAME_ROOT'?taxIdentity.reason:taxes.length===1?'CNPJ localizado no bloco do destinatário.':'CNPJ do destinatário ausente ou ambíguo; emitente não é destinatário.'),
  field('address','Endereço da unidade',u.address,addresses,addressMatch?'MATCH':addresses.length===1?'MISMATCH':'INCONCLUSIVE',addressMatch?'Conteúdo do endereço preservado, ignorando pontuação e espaços.':'Confira logradouro, número/km e complemento no destinatário.'),
  field('unit','UC / instalação',u.consumer_unit_number,uc,uc.length?(unknown.length?'MISMATCH':'MATCH'):proof.checks.unit==='MATCH'?'MATCH':'INCONCLUSIVE',unknown.length?'Código impresso diferente do cadastro e do histórico autorizado.':'Usar apenas código explícito, nunca medidor ou código de barras.'),
  field('period','Competência de fornecimento',month,months,months.length===1?(months[0]===month?'MATCH':'MISMATCH'):'INCONCLUSIVE','Emissão e vencimento não substituem competência.')
 ];
 const identity=fields.slice(0,3),words=(raw?.pages??[]).flatMap((p:any)=>p.words??[]);
 const confident=(v:string)=>{if(!raw)return true;const a=compact(v);return a.length>=4&&words.some((_:any,i:number)=>{let s='';for(let j=i;j<Math.min(i+30,words.length);j++){if(!Number.isFinite(words[j].confidence)||words[j].confidence<=.85)break;s+=compact(String(words[j].content??''));if(s===a)return true;if(s.length>a.length)break;}return false;});};
 const reject=identity.every(f=>f.status==='MISMATCH'&&f.found.length===1&&confident(f.found[0]));
 const eligible=fields[0].status==='MATCH'&&fields[1].status==='MATCH'&&fields[2].status==='MISMATCH'&&unknown.length===1&&fields[3].status==='MATCH';
 fields[3].pages=[...new Set(pages.filter(p=>intakeMonthCandidates(p.text).includes(month)).map(p=>p.page))];
 const registration=identityRegistration(c,u,month),sourcePages=[...new Set(pages.map(p=>p.page))],result={version:'intake-identity-triage-1',fileHash:hash,registration,fields,sourcePages,read:true,...(taxIdentity.relation==='SAME_ROOT'?{taxIdentity}:{}),documentType:supplier?'INVOICE_SUPPLIER':'INVOICE_DISTRIBUTOR',action:reject?'REJECT':eligible?'CONTINUE_JUSTIFIED':'REVIEW',unitCode:eligible?unknown[0]:null};
 return {...result,fingerprint:createHash('sha256').update(JSON.stringify(result)).digest('hex')};
}

import {invoiceIdentityText} from '../ocr/invoice-identity-preflight';
import {supplierDocumentKind,supplierInvoiceProposal} from '../ocr/supplier-invoice-proposal';

export type IntakeUnit={id:string;customer_id:string;consumer_unit_number:string;address:string;aliases?:string[]};
export type IntakeCustomer={id:string;document:string;company_name:string};
export type IntakePage={page:number;text:string};
const compact=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const names=['JAN','FEV','MAR','ABR','MAI','JUN','JUL','AGO','SET','OUT','NOV','DEZ'];

/** Candidates are discovered from content, then checked by the same identity
 * rules used by the original invoice. Issue/due dates are never competence. */
export function intakeMonthCandidates(text:string){
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),months=new Set<string>();
 const add=(year:string,month:number)=>{if(/^20\d{2}$/.test(year)&&month>=1&&month<=12)months.add(year+'-'+String(month).padStart(2,'0'));};
 for(const m of t.matchAll(/\b(JAN[A-Z]*|FEV[A-Z]*|MAR[A-Z]*|ABR[A-Z]*|MAI[A-Z]*|JUN[A-Z]*|JUL[A-Z]*|AGO[A-Z]*|SET[A-Z]*|OUT[A-Z]*|NOV[A-Z]*|DEZ[A-Z]*)\s*[/.-]\s*(20\d{2})\b/g))add(m[2],names.indexOf(m[1].slice(0,3))+1);
 for(const m of t.matchAll(/(?:COMPETENCIA|REFERENCIA|REF\s*[:.]?\s*MES\s*\/\s*ANO|MES\s*\/\s*ANO|FATURAMENTO\s+REF|PERIODO DE SUPRIMENTO\s*\/\s*FORNECIMENTO)\s*[:.]?\s*(0?[1-9]|1[0-2])\/(20\d{2})\b/g))add(m[2],Number(m[1]));
 return [...months].sort();
}

export function automaticIntakeContext(pages:IntakePage[],customer:IntakeCustomer,units:IntakeUnit[],hash:string,hints:{unitId?:string;month?:string}={}){
 const review=(reason:string,candidates:unknown[]=[])=>({state:'REVIEW_REQUIRED' as const,reason,candidates});
 if(!/^[a-f0-9]{64}$/.test(hash)||!pages.length||pages.length>100||pages.some(p=>!Number.isInteger(p.page)||p.page<1||typeof p.text!=='string')||pages.reduce((n,p)=>n+p.text.length,0)>2097152||!customer?.id||!customer.document||units.length>100||units.some(u=>u.customer_id!==customer.id))return review('A fonte ou o escopo do cliente exige conferência.');
 const text=pages.map(p=>p.text).join('\n'),months=intakeMonthCandidates(text);
 if(!months.length||months.length>12)return review('Não consegui comprovar uma competência de fornecimento no arquivo. Data de emissão ou vencimento não substitui mês de referência.');
 const kind=supplierDocumentKind(text),matches:any[]=[];
 if(kind==='CONTRACT')return review('O arquivo contém um contrato. Confira seu tipo e vigência; ele não será tratado como fatura.');
 for(const month of months)for(const unit of units){
  if(kind==='INVOICE'){
   const proposal=supplierInvoiceProposal(text,month,customer.document,{documentId:'pending-intake',fileHash:hash});
   if(!proposal)continue;
   // A single authorized unit is unambiguous. With multiple units, require its
   // recipient address or explicit UC, never issuer address or upload filename.
   const recipient=text.split(/DESTINAT.RIO\s*\/\s*REMETENTE/i)[1]?.split(/CALCULO DO IMPOSTO|DADOS DO PRODUTO|FATURA\s*\/\s*DUPLICATA/i)[0]??'';
   const address=compact(unit.address??''),uc=compact(unit.consumer_unit_number??'');
   if(units.length!==1&&!(address.length>=12&&compact(recipient).includes(address))&&!(uc.length>=5&&new RegExp('(?:UC|INSTALA[ÇC][ÃA]O)\\s*[:.]?\\s*'+unit.consumer_unit_number.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(recipient)))continue;
   matches.push({unitId:unit.id,month,documentType:'INVOICE_SUPPLIER',checks:{taxId:'MATCH',unit:'MATCH',period:'MATCH'},sourcePages:pages.map(p=>p.page)});
  }else{
   const proof=invoiceIdentityText(text,{customerName:customer.company_name,taxId:customer.document,unitNumber:unit.consumer_unit_number,address:unit.address,month,auditedUnitNumbers:unit.aliases??[]});
   if(proof.state==='MATCH')matches.push({unitId:unit.id,month,documentType:'INVOICE_DISTRIBUTOR',checks:proof.checks,sourcePages:pages.map(p=>p.page)});
  }
 }
 const selected=matches.filter(m=>(!hints.unitId||m.unitId===hints.unitId)&&(!hints.month||m.month===hints.month));
 if(selected.length!==1)return review(matches.length?'Mais de um vínculo ou competência corresponde ao arquivo. Confirme somente o vínculo correto.':'O conteúdo não comprova o vínculo e a competência dentro deste cliente.',matches);
 const match=selected[0];
 if(hints.unitId&&hints.unitId!==match.unitId||hints.month&&hints.month!==match.month)return review('A seleção informada diverge da identidade ou competência do documento.',matches);
 return {state:'MATCH' as const,...match,fileHash:hash,customerId:customer.id,version:'automatic-intake-context-1'};
}

/** Paid OCR is source evidence, not a human attestation. Low/missing word
 * confidence on identity or NF amounts requires a focused review. */
export function automaticOcrIdentityConfidence(raw:any,proof:any,customer:IntakeCustomer,unit:IntakeUnit){
 const words=(raw?.pages??[]).flatMap((p:any)=>p.words??[]).filter((w:any)=>typeof w.content==='string');
 if(!words.length||words.length>250000)return false;
 let text='';const offsets:{start:number;end:number;confidence:number}[]=[];
 for(const w of words){const value=compact(w.content);if(!value)continue;offsets.push({start:text.length,end:text.length+value.length,confidence:w.confidence});text+=value;}
 const proven=(value:string)=>{const needle=compact(value);if(needle.length<4)return false;let at=text.indexOf(needle),found=false;while(at>=0){found=true;let lo=0,hi=offsets.length;while(lo<hi){const mid=(lo+hi)>>>1;if(offsets[mid].end<=at)lo=mid+1;else hi=mid;}for(let n=lo;n<offsets.length&&offsets[n].start<at+needle.length;n++)if(!Number.isFinite(offsets[n].confidence)||offsets[n].confidence<=0.85)return false;at=text.indexOf(needle,at+needle.length);}return found;};
 if(!proven(customer.document))return false;
 const [year,month]=proof.month.split('-'),fullNames=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
 if(![month+year,names[Number(month)-1]+year,fullNames[Number(month)-1]+year].some(proven))return false;
 if(proof.documentType==='INVOICE_DISTRIBUTOR')return [unit.consumer_unit_number,...(unit.aliases??[])].some(proven)&&proven(unit.address);
 const proposal=supplierInvoiceProposal(raw.content,proof.month,customer.document,{documentId:'pending-intake',fileHash:proof.fileHash});
 return !!proposal&&[proposal.quantityMwh,proposal.pricePerMwh,proposal.amount].every(proven);
}

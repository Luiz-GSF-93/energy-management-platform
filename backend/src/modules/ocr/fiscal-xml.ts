import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {createHash} from 'node:crypto';
import {BadRequestException} from '@nestjs/common';
import {validTaxId} from '../../common/validation/tax-id';
import {companyTaxIdentity} from './eva-preparation-policy';
import {supplierUnitIdentity,supplierUnitCodes} from './supplier-unit-identity';

export const FISCAL_XML_VERSION='fiscal-xml-1';
export const MAX_FISCAL_XML_BYTES=2*1024*1024;
const list=(v:any):any[]=>v==null?[]:Array.isArray(v)?v:[v];
const node=(v:any)=>v&&typeof v==='object'&&!Array.isArray(v)?v:{};
const str=(v:any)=>typeof v==='string'?v.trim():'';
const compact=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const decimal=(v:unknown,places=8)=>typeof v==='string'&&new RegExp('^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,'+places+'})?$').test(v)?v:null;
const scaled=(v:string)=>{const [a,b='']=v.split('.');return BigInt(a)*100000000n+BigInt(b.padEnd(8,'0'));};
const money=(v:string)=>{const n=scaled(v);return n%1000000n===0n?(n/100000000n)+'.'+((n%100000000n)/1000000n).toString().padStart(2,'0'):null;};
const keyValid=(k:string)=>{if(!/^\d{44}$/.test(k))return false;let sum=0,w=2;for(let i=42;i>=0;i--){sum+=Number(k[i])*w;w=w===9?2:w+1;}const v=11-sum%11;return Number(k[43])===(v>=10?0:v);};

export function readFiscalXml(bytes:Buffer){
 const fail=(reason='Estrutura fiscal incompleta ou inválida.')=>{throw new BadRequestException({code:'EVA_XML_REJECTED',message:'XML não recebido. '+reason+' Envie o XML original NF-e/NF3e, de até 2 MB, ou utilize a nota em PDF.'});};
 if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.length>MAX_FISCAL_XML_BYTES) return fail('Tamanho do arquivo inválido.');
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return fail('Codificação inválida: é necessário UTF-8.');}
 text=text.replace(/^\uFEFF/,'');
 if(/<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|[\x00-\x08\x0b\x0c\x0e-\x1f]/i.test(text))return fail('O arquivo contém entidades, instruções ou caracteres não permitidos.');
 if(/encoding\s*=\s*['"](?!UTF-8['"])/i.test(text))return fail('Codificação não suportada: é necessário UTF-8.');
 if(XMLValidator.validate(text)!==true)return fail('O conteúdo está malformado ou incompleto.');
 // Bound nesting and node count before the parser allocates the object graph.
 let depth=0,count=0;for(const m of text.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/?([A-Za-z_][^<>]*?)>/g)){
  if(!m[1])continue;if(++count>20000)return fail();if(m[0].startsWith('</'))depth--;else if(!m[0].endsWith('/>'))depth++;
  if(depth<0||depth>40)return fail();
 }
 if(depth!==0)return fail();
 let root:any;try{root=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:true,processEntities:true,allowBooleanAttributes:false}).parse(text);}catch{return fail();}
 const roots=Object.keys(root).filter(k=>k!=='?xml');if(roots.length!==1)return fail();
 const tag=roots[0],model=['nfeProc','NFe'].includes(tag)?'55':['nf3eProc','NF3e'].includes(tag)?'66':null;if(!model)return fail('O conteúdo não é um XML fiscal NF-e (modelo 55) ou NF3e (modelo 66). É necessária a estrutura fiscal original.');
 const namespace=model==='55'?'http://www.portalfiscal.inf.br/nfe':'http://www.portalfiscal.inf.br/nf3e',wrapper=node(root[tag]);
 if(wrapper['@_xmlns']!==namespace)return fail('A identificação do formato fiscal (namespace) está ausente ou não é suportada.');
 // Reject namespace rebinding/prefixed fiscal fields rather than stripping a
 // namespace and accidentally accepting a different recipient or total.
 const walk=(v:any,inSignature=false)=>{if(Array.isArray(v)){for(const x of v)walk(x,inSignature);return;}if(!v||typeof v!=='object')return;
  for(const [k,x] of Object.entries(v)){if(k==='Signature'||k==='ds:Signature')continue;if(k.startsWith('@_xmlns')&&x!==namespace)fail();if(!k.startsWith('@_')&&k.includes(':'))fail();walk(x,inSignature);}};walk(wrapper);
 const document=node(tag.endsWith('Proc')?wrapper[model==='55'?'NFe':'NF3e']:wrapper),info=node(document[model==='55'?'infNFe':'infNF3e']);
 const ide=node(info.ide),emit=node(info.emit),dest=node(info.dest),address=node(dest.enderDest),total=node(model==='55'?node(info.total).ICMSTot:info.total);
 if(str(ide.mod)!==model||str(ide.tpAmb)!=='1'||!/^\d{1,9}$/.test(str(ide.nNF))||!validTaxId(str(emit.CNPJ))||!validTaxId(str(dest.CNPJ))||!str(dest.xNome)||!str(emit.xNome)||!str(address.xLgr)||!str(address.nro))return fail();
 const id=str(info['@_Id']),key=id.replace(model==='55'?/^NFe/:/^NF3e/,'');if(!keyValid(key)||key.slice(20,22)!==model||key.slice(6,20)!==str(emit.CNPJ))return fail('Chave de acesso ausente, inválida ou incompatível com o emitente e o modelo.');
 const protocol=node(node(wrapper[model==='55'?'protNFe':'protNF3e']).infProt),declaredStatus=str(protocol.cStat),protocolKey=str(protocol[model==='55'?'chNFe':'chNF3e']);
 if(declaredStatus&&declaredStatus!=='100'||protocolKey&&protocolKey!==key)return fail('O protocolo informado não indica autorização aceita ou corresponde a outra chave.');
 const amount=decimal(total.vNF,2);if(!amount)return fail();
 const extra=str(node(info.infAdic).infCpl);if(extra.length>12000)return fail();
 const items=model==='55'?list(info.det):list(info.NFdet).flatMap(g=>list(node(g).det));if(!items.length||items.length>500)return fail();
 const rows=items.map((d:any)=>{const p=model==='55'?node(d.prod):node(node(node(d).detItem).prod);return {description:str(p.xProd).slice(0,1000),unit:model==='55'?str(p.uCom):({'1':'KW','2':'KWH','3':'KVAR','4':'KVARH','5':'UN'} as Record<string,string>)[str(p.uMed)]??str(p.uMed),quantity:decimal(p.qCom??p.qFaturada),price:decimal(p.vUnCom??p.vItem),amount:decimal(p.vProd,2),classification:str(p.cClass),xmlItem:str(d['@_nItem']),taxes:model==='55'?node(d.imposto):node(p.imposto)};});
 const months=new Set<string>();const month=str(node(info.gFat).CompetFat);if(/^20\d{2}(0[1-9]|1[0-2])$/.test(month))months.add(month.slice(0,4)+'-'+month.slice(4));
 const referenceText=[extra,...rows.map(r=>r.description)].join('\n').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 for(const m of referenceText.matchAll(/(?:COMPETENCIA|REFERENCIA|MES DE REFERENCIA|FATURAMENTO REF)\s*[:.]?\s*(0?[1-9]|1[0-2])\/(20\d{2})\b/g))months.add(m[2]+'-'+m[1].padStart(2,'0'));
 const names=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
 for(const m of referenceText.matchAll(/FORNECIDA\s+NO\s+MES\s+DE\s+([A-Z]+)\/(20\d{2})\b/g)){const n=names.indexOf(m[1]);if(n>=0)months.add(m[2]+'-'+String(n+1).padStart(2,'0'));}
 const units=new Set<string>();const access=str(node(info.acessante).idAcesso);if(/^[-.0-9]{5,32}$/.test(access))units.add(access);
 for(const code of supplierUnitCodes([extra,...rows.map(row=>row.description)].join('\n')))units.add(code);
 const recipientAddress=[address.xLgr,address.nro,address.xCpl,address.xBairro].map(str).filter(Boolean).join(', ');
 const delivery=node(info.entrega),deliveryAddress=[delivery.xLgr,delivery.nro,delivery.xCpl,delivery.xBairro].map(str).filter(Boolean).join(', ');
 // Content is a labelled field view, not a PDF page or OCR transcription.
 const content=[model==='66'?'NF3e · XML fiscal de energia':'NF-e · XML do fornecedor','Emitente: '+str(emit.xNome),'CNPJ do emitente: '+str(emit.CNPJ),'Destinatário: '+str(dest.xNome),'CNPJ: '+str(dest.CNPJ),'Endereço: '+recipientAddress,...[...units].map(u=>'UC: '+u),...[...months].map(m=>'Competência: '+m.slice(5)+'/'+m.slice(0,4)),'Valor total: '+amount,'Chave de acesso: '+key,...rows.map(r=>r.description+' | '+r.unit+' | '+(r.quantity??'não informado')+' | '+(r.amount??'não informado')),extra].join('\n');
 const field=(value:string)=>{const offset=content.indexOf(value);return {content:value,confidence:null,spans:[{offset,length:value.length}],boundingRegions:[{pageNumber:1}],evidenceKind:'XML_NODE'};};
 const fields={CustomerName:field(str(dest.xNome)),CustomerTaxId:field(str(dest.CNPJ)),ServiceAddress:field(recipientAddress),VendorName:field(str(emit.xNome)),VendorTaxId:field(str(emit.CNPJ)),InvoiceId:field(str(ide.nNF)),InvoiceTotal:field(amount)};
 const sourceHash=createHash('sha256').update(bytes).digest('hex');
 const fiscal={version:FISCAL_XML_VERSION,model,kind:model==='66'?'INVOICE_DISTRIBUTOR':'INVOICE_SUPPLIER',sourceHash,issuer:{taxId:str(emit.CNPJ),name:str(emit.xNome)},recipient:{taxId:str(dest.CNPJ),name:str(dest.xNome),address:recipientAddress},...(deliveryAddress?{deliveryAddress}:{}),unitCodes:[...units],months:[...months],amount:money(amount)!,key,rows,extra,protocolStatus:declaredStatus||null,signatureVerified:false,authorizationVerified:false};
 // Reinterpretation reads the original nodes without replacing a preserved raw extraction.
 const sourcePrices=items.map((d:any)=>{const p=model==='55'?node(d.prod):node(node(node(d).detItem).prod);return decimal(p.vUnCom??p.vItem,12);});
 return {fiscal,sourcePrices,raw:{content,contentUnit:'XML_FIELDS',xml:fiscal,pages:[{pageNumber:1,lines:content.split('\n').map(content=>({content}))}],documents:[{fields}],keyValuePairs:[],tables:[]}};
}

/** Explicit supply labels only: issue/payment dates are never competence. The
 * stored fiscal/raw object remains unchanged so preserved extractions replay. */
export function fiscalSupplyMonths(fiscal:{months:string[];extra:string;rows:{description:string}[]}){
 const months=new Set(fiscal.months),text=[fiscal.extra,...fiscal.rows.map(r=>r.description)].join('\n').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
 for(const m of text.matchAll(/PERIODO\s+DE\s+(?:SUPRIMENTO\s+)?FORNECIMENTO\s*[:.]?\s*(0?[1-9]|1[0-2])(?:\s*[/.-]\s*|\s+)(20\d{2})\b/g))months.add(m[2]+'-'+m[1].padStart(2,'0'));
 return [...months];
}

export function xmlUnitMatch(fiscal:ReturnType<typeof readFiscalXml>['fiscal'],customer:{document:string|null},unit:{consumer_unit_number:string|null;address:string|null;aliases?:string[];auditedAddresses?:string[]},month:string|null){
 const address=compact(unit.address??''),addressMatch=address.length>=12&&compact(fiscal.recipient.address)===address;
 const units=[unit.consumer_unit_number??'',...unit.aliases??[]].map(compact),unitMatch=fiscal.unitCodes.length>0&&fiscal.unitCodes.every(v=>units.includes(compact(v)));
 const months=fiscalSupplyMonths(fiscal),period=months.length===1&&months[0]===month;
 if(fiscal.kind==='INVOICE_SUPPLIER'){
  const proof=supplierUnitIdentity(customer.document??'',fiscal.recipient.taxId,{unitNumber:unit.consumer_unit_number??'',address:unit.address??'',aliases:unit.aliases,auditedAddresses:unit.auditedAddresses},fiscal.unitCodes,[fiscal.recipient.address,fiscal.deliveryAddress??''],period);
  return {matched:proof.matched,taxIdentity:proof.taxIdentity,addressMatch:proof.addressMatch,unitMatch:proof.unitMatch,period};
 }
 const tax=companyTaxIdentity(customer.document??'',[fiscal.recipient.taxId],{unit:unitMatch,address:addressMatch,period});
 return {matched:tax.accepted&&addressMatch&&period&&(unitMatch||fiscal.kind==='INVOICE_SUPPLIER'&&fiscal.unitCodes.length===0),taxIdentity:tax,addressMatch,unitMatch,period};
}

export function xmlSupplierProposal(xml:ReturnType<typeof readFiscalXml>,month:string,taxId:string,source:{documentId:string;fileHash:string},unit:{unitNumber:string;address:string;aliases?:string[];auditedAddresses?:string[]}){
 const f=xml.fiscal,proof=xmlUnitMatch(f,{document:taxId},{consumer_unit_number:unit.unitNumber,address:unit.address,aliases:unit.aliases,auditedAddresses:unit.auditedAddresses},month);
 if(f.kind!=='INVOICE_SUPPLIER'||source.fileHash!==f.sourceHash||!proof.matched||f.rows.length!==1)return null;
 const row=f.rows[0],price=xml.sourcePrices?.[0]??row.price;if(!/ENERGIA|CONSUMO CONTRATADO/i.test(row.description)||row.unit.toUpperCase()!=='MWH'||!row.quantity||!price||!row.amount)return null;
 const precision=(v:string)=>{const [whole,decimal='']=v.split('.');return BigInt(whole)*10n**12n+BigInt(decimal.padEnd(12,'0'));};
 const product=precision(row.quantity)*precision(price),cent=10n**22n;
 if(money(row.amount)!==f.amount||(product+cent/2n)/cent!==precision(row.amount)/10n**10n)return null;
 // Additional freight/taxes/discounts not represented in this single energy row
 // prevent total reconciliation above; no exemption or net tax is inferred.
 return {format:'supplier-invoice-proposal-1',month,quantityMwh:row.quantity,pricePerMwh:price,amount:f.amount,...source,nature:'DOCUMENT_PROPOSAL',reviewRequired:true,financialApproval:false,taxTreatment:'REVIEW',taxEvidence:null,fiscalIdentity:{kind:'NFE_ACCESS_KEY',key:f.key},taxIdentity:proof.taxIdentity,observations:['Extração determinística do XML; valores e protocolo declarados pelo arquivo. Assinatura e situação fiscal não foram consultadas. Não comprova pagamento.'],xmlVersion:FISCAL_XML_VERSION};
}

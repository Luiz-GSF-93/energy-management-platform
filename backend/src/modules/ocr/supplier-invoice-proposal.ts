const normalized=(text:string)=>text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
export function supplierDocumentKind(text:string):'INVOICE'|'CONTRACT'|'UNKNOWN'{
 const t=normalized(text).replace(/DADOS DOS PRODUTOS\s*\/\s*SERVICOS/g,'DADOS DO PRODUTO / SERVICO');
 if(/\bDANFE\b/.test(t)&&/DADOS DO PRODUTO\s*\/\s*SERVI.O/.test(t)&&/CNPJ/.test(t))return 'INVOICE';
 if(/\b(?:CONTRATO|MINUTA|ANEXO)\b/.test(t)&&/CONTRATANTE|CONTRATADA|COMPRADORA|VENDEDORA|CLAUSULA/.test(t))return 'CONTRACT';
 return 'UNKNOWN';
}
/** Local DANFE evidence. It never attests payment, monthly allocation or tax exemption. */
export function supplierInvoiceProposal(text:string,month:string,taxId:string,source:{documentId:string;fileHash:string}){
 const t=normalized(text).replace(/DADOS DOS PRODUTOS\s*\/\s*SERVICOS/g,'DADOS DO PRODUTO / SERVICO'),digits=(s:string)=>s.replace(/\D/g,'');
 if(!/^[a-f0-9]{64}$/.test(source.fileHash)||digits(taxId).length!==14)return null;
 const recipient=t.split(/DESTINAT.RIO\s*\/\s*REMETENTE/);
 const reverse=t.split(/PROTOCOLO DE AUTORIZACAO DE USO/);
 // Some DANFEs serialize recipient cells before the recipient heading.
 const recipientSection=recipient.length===2?recipient[1].split(/FATURA\s*\/\s*DUPLICATAS?|(?:^|\n)\s*FATURA\b|CALCULO DO IMPOSTO/)[0]:reverse.length===2?reverse[1].split(/CALCULO DO IMPOSTO/)[0]:null;
 if(!recipientSection)return null;
 // Prefer the explicitly formatted CNPJ cell. Native PDF streams may join a
 // phone/time/IE into 14 bare digits; those are not a second formatted CNPJ.
 const formattedIds=Array.from(recipientSection.matchAll(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g));
 const recipientIds=formattedIds.length?formattedIds:Array.from(recipientSection.matchAll(/\b\d{14}\b/g));
 if(recipientIds.length!==1||digits(recipientIds[0][0])!==digits(taxId))return null;
 const product=t.split(/DADOS DO PRODUTO\s*\/\s*SERVI.O/);
 if(product.length!==2)return null;
 // The native PDF stream may serialize the product table before its heading.
 // Accept only the explicit table header and stop at the tax summary.
 const nativeRows=t.split(/CD\.\s*PROD\.\s+DESCRICAO PRODUTO\s*\/\s*SERVICO/);
 // A narrow DANFE layout wraps the final "h" of MWh below its complete
 // product row. Require that actual glyph and table columns; bare MW is power.
 const wrapped=product[1].split('DADOS ADICIONAIS')[0];
 const energyRows=/CFOP\s+UN\s+QUANT\.\s+V\.UNITARIO\s+V\.TOTAL\s+BC\.ICMS/.test(wrapped)
  ?wrapped.replace(/\bMW(\s+[^\n]+)\n[ \t]*H(?=\s*$|\n)/g,'MWH$1'):wrapped;
 const section=energyRows.includes('MWH')?energyRows:nativeRows.length===2?nativeRows[1].split('CALCULO DO IMPOSTO')[0]:'',months=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
 const periods=Array.from(section.matchAll(/FORNECIDA\s+NO\s+M.S\s+DE\s+([A-Z]+)\/(20\d{2})/g));
 const references=Array.from(t.matchAll(/FATURAMENTO\s+REF\s+(0?[1-9]|1[0-2])\/(20\d{2})/g));
 const referenceMonths=Array.from(t.matchAll(/\bMES\s+DE\s+REFERENCIA\s*[:.]?\s*(0?[1-9]|1[0-2])\/(20\d{2})\b/g));
 const supplyPeriods=Array.from(t.matchAll(/PERIODO DE SUPRIMENTO\s*\/\s*FORNECIMENTO:\s*(0?[1-9]|1[0-2])\/(20\d{2})/g));
 const declared=[...supplyPeriods.map(p=>p[2]+'-'+p[1].padStart(2,'0')),...periods.map(p=>p[2]+'-'+String(months.indexOf(p[1])+1).padStart(2,'0')),...references.map(p=>p[2]+'-'+p[1].padStart(2,'0')),...referenceMonths.map(p=>p[2]+'-'+p[1].padStart(2,'0'))];
 if(!declared.length||declared.some(p=>p!==month)||!(section.includes('ENERGIA ELETRICA')||section.includes('CONSUMO CONTRATADO')&&/\b2716\.?00\.?00\b/.test(section)))return null;
 const decimal='([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2,6}|[0-9]+,[0-9]{2,6})';
 const lines=Array.from(section.matchAll(new RegExp('\\bMWH\\s+'+decimal+'\\s+'+decimal+'\\s+'+decimal,'g')));
 let values:string[]|undefined=lines.length===1&&lines[0][3]!=='0,00'?[lines[0][1],lines[0][2],lines[0][3]]:undefined;
 const fiscalText=t.replace(/\s+/g,' ').replace(/\b(?:NAO|SEM)\s+ICMS A SER LANCADO E RECOLHIDO[^.]*?(?=\.|$)/g,'');
 const destinationIcms=/RESPONSABILIDADE\s+PELO\s+RECOLHIMENTO\s+DO\s+ICMS\s+FICA\s+ATRIBUIDA\s+AO\s+DESTIN(?:AT)?ARIO/.test(fiscalText)||/\bICMS A SER LANCADO E RECOLHIDO PELO DESTINATARIO DA ENERGIA NOS TERMOS DO DISPOSTO NO ARTIGO 425[- ]D DO RICMS[- ]SP\/(?:2000|2022)\b/.test(fiscalText);
 if(!values&&supplierDocumentKind(t)==='INVOICE'){
  const rows=Array.from(section.matchAll(/\bMWH\s+([^\n]+)/g));
  if(rows.length!==1)return null;
  const cells=rows[0][1].match(new RegExp(decimal,'g'))??[];
  // Quantity, total, five zero tax cells, unit price: require the complete
  // known layout and its destination-ICMS clause, never infer exemption from 0.
  if(cells.length!==8||cells.slice(2,7).some(v=>v!=='0,00')||!destinationIcms)return null;
  values=[cells[0],cells[7],cells[1]];
 }
 if(!values||Array.from(section.matchAll(/\bMWH\b/g)).length!==1)return null;
 const parse=(s:string)=>s.replace(/\./g,'').replace(',','.');
 const [q,p,a]=values,quantityMwh=parse(q),pricePerMwh=parse(p),amount=parse(a);
 if(!/^\d+\.\d{2}$/.test(amount)||Number(quantityMwh)<=0||Number(pricePerMwh)<=0)return null;
 const scale=(s:string)=>{const [w,f='']=s.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
 const expected=(scale(quantityMwh)*scale(pricePerMwh)*100n+500000000000n)/1000000000000n;
 if(expected!==scale(amount)/10000n)return null;
 const fatura=t.match(/VALOR\s+ORIGINAL:\s*([\d.,]+),\s*VALOR\s+DO\s+DESCONTO:\s*([\d.,]+),\s*VALOR\s+L.QU[IÍ]DO:\s*([\d.,]+)/);
 const installment=t.match(/FATURA:\s*\d+\s+VENCIMENTO:\s*\d{2}\/\d{2}\/\d{4}\s+VALOR:\s*([\d.,]+)/);
 if(fatura){if(parse(fatura[1])!==amount||Number(parse(fatura[2]))!==0||parse(fatura[3])!==amount)return null;}
 else if(!destinationIcms||!installment||parse(installment[1])!==amount){
  const totals=t.match(/VALOR TOTAL DA NF\s*\n([^\n]+)/),cells=totals?.[1].match(new RegExp(decimal,'g'))??[];
  const billing=t.match(/FATURA\s*\/\s*DUPLICATA[^\n]*\n\s*\d+\s+\d{2}\.\d{2}\.\d{4}\s+([\d.,]+)/);
  const summary=t.split('CALCULO DO IMPOSTO');
  const labeled=(label:string)=>{const matches=[...(summary[1]??'').matchAll(new RegExp('(?:^|\\n)[ \t]*'+label+'\\s*\\n\\s*'+decimal+'(?=\\s|$)','g'))];return matches.length===1?parse(matches[0][1]):null;};
  const nativeTotal=summary.length===2&&labeled('VALOR TOTAL DA NF')===amount&&labeled('VALOR TOTAL PRODUTOS')===amount&&['VALOR DO FRETE','VALOR DO SEGURO','DESCONTO','OUTRAS DESPESAS','VALOR DO IPI'].every(label=>labeled(label)==='0.00');
  const wrappedTotal=referenceMonths.length===1&&labeled('VALOR TOTAL DA NOTA')===amount&&labeled('VALOR TOTAL DOS PRODUTOS')===amount&&['VALOR DO FRETE','VALOR DO SEGURO','DESCONTO','OUTRAS DESPESAS ACESSORIAS','VALOR DO IPI'].every(label=>labeled(label)==='0.00');
  const wrappedBilling=t.match(/(?:^|\n)\s*FATURA\s*\n\s*\d+\s*\n\s*\d{2}\/\d{2}\/\d{4}\s*\n\s*([\d.,]+)/);
  const reconciledWrapped=wrappedTotal&&wrappedBilling&&parse(wrappedBilling[1])===amount;
  const horizontalTotal=cells.length===6&&!cells.slice(0,5).some(v=>Number(parse(v))!==0)&&parse(cells[5])===amount;
  if(!reconciledWrapped&&(supplyPeriods.length!==1||!horizontalTotal&&!nativeTotal||!billing||parse(billing[1])!==amount))return null;
 }

 // Positive ICMS explicitly printed on the reconciled total is already included.
 // A zero or absent cell never proves exemption or a final tax treatment.
 const taxSummary=t.split('CALCULO DO IMPOSTO');
 const taxCell=(label:string)=>{const matches=[...(taxSummary.length===2?taxSummary[1]:'').matchAll(new RegExp('(?:^|\\n)[ \\t]*'+label+'[ \\t]*\\n[ \\t]*'+decimal+'(?=\\s|$)','g'))];return matches.length===1?parse(matches[0][1]):null;};
 const printedIcms=taxCell('VALOR DO ICMS'),printedBase=taxCell('BASE (?:DE CALCULO DO ICMS|CALC(?:ULO)? ICMS)');
 const includedIcms=printedIcms!==null&&printedBase!==null&&scale(printedBase)===scale(amount)&&scale(printedIcms)>0n&&scale(printedIcms)<scale(printedBase);
 const taxTreatment=includedIcms&&!destinationIcms?'INCLUDED':destinationIcms&&!includedIcms?'NET_DESTINATION_ICMS':'UNCONFIRMED';
 const taxEvidence=includedIcms?{kind:destinationIcms?'CONFLICTING_ICMS':'INVOICE_ICMS_INCLUDED',source:destinationIcms?'A NF mostra ICMS positivo e também atribui recolhimento ao destinatário; conferir a composição para não duplicar tributos.':'ICMS positivo destacado na NF sobre base igual ao total faturado conciliado; imposto já incluído, sem novo acréscimo.',icmsBase:printedBase,icmsAmount:printedIcms}:null;

 // This is a statement printed on the invoice, not proof of exemption at destination.
 const originStatement=/NAO INCIDENCIA DE ICMS CONFORME ART(?:IGO|\.)?\s*(?:TERCEIRO|3[Oº°]?) DA LEI COMPLEMENTAR (?:87\/96|8796)\b/.test(fiscalText)&&/\b2716\.?00\.?00\s+041\s+6252\s+MWH\b/.test(section)&&/\bVALOR DO ICMS\s*\n\s*0,00(?=\s|$)/.test(t);
 // A verified NF-e access key identifies the same fiscal note across different PDFs.
 const accessKeys=[...t.matchAll(/(?:^|[^0-9])((?:[0-9][ \t]*){44})(?![0-9])/g)].map(m=>m[1].replace(/\D/g,''));
 const validKeys=[...new Set(accessKeys.filter(k=>{let sum=0,weight=2;for(let i=42;i>=0;i--){sum+=Number(k[i])*weight;weight=weight===9?2:weight+1;}const v=11-sum%11;return Number(k[43])===(v>=10?0:v)&&['55','65'].includes(k.slice(20,22));}))];
 const fiscalIdentity=validKeys.length===1?{kind:'NFE_ACCESS_KEY',key:validKeys[0]}:null;
 if(/\b(?:NF-?E|NOTA FISCAL)\s+CANCELADA\b|\bNOTA FISCAL (?:DE )?(?:DEVOLUCAO|CREDITO)\b|\bNF-?E DE AJUSTE\b/.test(t))return null;
 return {format:'supplier-invoice-proposal-1',month,quantityMwh,pricePerMwh,amount,...source,nature:'DOCUMENT_PROPOSAL',reviewRequired:true,financialApproval:false,taxTreatment,fiscalIdentity,taxEvidence:taxEvidence??(destinationIcms?{kind:'DESTINATION_ICMS',source:'Informações complementares da NF: recolhimento do ICMS atribuído ao destinatário; zeros impressos não representam isenção.'}:originStatement?{kind:'ORIGIN_NON_INCIDENCE_REVIEW',source:'A NF declara não incidência de ICMS conforme art. terceiro da LC 87/96. O tratamento tributário final da unidade ainda exige revisão; não foi declarada isenção no destino.'}:null),observations:['Valores faturados da NF propostos para conferência; não comprovam pagamento ou cobertura integral por si só. Volume comprado preservado separadamente do consumo medido.']};
}

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
 const recipientSection=recipient.length===2?recipient[1].split(/FATURA\s*\/\s*DUPLICATAS?/)[0]:reverse.length===2?reverse[1].split(/CALCULO DO IMPOSTO/)[0]:null;
 if(!recipientSection)return null;
 const recipientIds=Array.from(recipientSection.matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/g));
 if(recipientIds.length!==1||digits(recipientIds[0][0])!==digits(taxId))return null;
 const product=t.split(/DADOS DO PRODUTO\s*\/\s*SERVI.O/);
 if(product.length!==2)return null;
 const section=product[1].split('DADOS ADICIONAIS')[0],months=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
 const periods=Array.from(section.matchAll(/FORNECIDA\s+NO\s+M.S\s+DE\s+([A-Z]+)\/(20\d{2})/g));
 const references=Array.from(t.matchAll(/FATURAMENTO\s+REF\s+(0?[1-9]|1[0-2])\/(20\d{2})/g));
 const supplyPeriods=Array.from(t.matchAll(/PERIODO DE SUPRIMENTO\s*\/\s*FORNECIMENTO:\s*(0?[1-9]|1[0-2])\/(20\d{2})/g));
 const declared=[...supplyPeriods.map(p=>p[2]+'-'+p[1].padStart(2,'0')),...periods.map(p=>p[2]+'-'+String(months.indexOf(p[1])+1).padStart(2,'0')),...references.map(p=>p[2]+'-'+p[1].padStart(2,'0'))];
 if(!declared.length||declared.some(p=>p!==month)||!(section.includes('ENERGIA ELETRICA')||section.includes('CONSUMO CONTRATADO')&&/\b2716\.?00\.?00\b/.test(section)))return null;
 const decimal='([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2,6}|[0-9]+,[0-9]{2,6})';
 const lines=Array.from(section.matchAll(new RegExp('\\bMWH\\s+'+decimal+'\\s+'+decimal+'\\s+'+decimal,'g')));
 let values:string[]|undefined=lines.length===1&&lines[0][3]!=='0,00'?[lines[0][1],lines[0][2],lines[0][3]]:undefined;
 let destinationIcms=false;
 if(!values&&supplierDocumentKind(t)==='INVOICE'){
  const rows=Array.from(section.matchAll(/\bMWH\s+([^\n]+)/g));
  if(rows.length!==1)return null;
  const cells=rows[0][1].match(new RegExp(decimal,'g'))??[];
  // Quantity, total, five zero tax cells, unit price: require the complete
  // known layout and its destination-ICMS clause, never infer exemption from 0.
  destinationIcms=/RESPONSABILIDADE\s+PELO\s+RECOLHIMENTO\s+DO\s+ICMS\s+FICA\s+ATRIBUIDA\s+AO\s+DESTIN(?:AT)?ARIO/.test(t.replace(/\s+/g,' '));
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
  if(supplyPeriods.length!==1||cells.length!==6||cells.slice(0,5).some(v=>Number(parse(v))!==0)||parse(cells[5])!==amount||!billing||parse(billing[1])!==amount)return null;
 }
 return {format:'supplier-invoice-proposal-1',month,quantityMwh,pricePerMwh,amount,...source,nature:'DOCUMENT_PROPOSAL',reviewRequired:true,financialApproval:false,taxTreatment:destinationIcms?'NET_DESTINATION_ICMS':'UNCONFIRMED',taxEvidence:destinationIcms?{kind:'DESTINATION_ICMS',source:'Informações complementares da NF: recolhimento do ICMS atribuído ao destinatário; zeros impressos não representam isenção.'}:null,observations:['Valores faturados da NF propostos para conferência; não comprovam pagamento ou cobertura integral por si só. Volume comprado preservado separadamente do consumo medido.']};
}

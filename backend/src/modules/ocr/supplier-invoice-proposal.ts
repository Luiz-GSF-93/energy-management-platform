/** Conservative text-only DANFE proposal. It does not attest payment, allocation or tax exemption. */
export function supplierInvoiceProposal(text:string,month:string,taxId:string,source:{documentId:string;fileHash:string}){
 const t=text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase(),digits=(s:string)=>s.replace(/\D/g,'');
 if(!/^[a-f0-9]{64}$/.test(source.fileHash)||digits(taxId).length!==14)return null;
 const recipient=t.split(/DESTINAT.RIO\s*\/\s*REMETENTE/);
 if(recipient.length!==2)return null;
 const recipientIds=Array.from(recipient[1].split(/FATURA\s*\/\s*DUPLICATAS/)[0].matchAll(/\b(?:\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|\d{14})\b/g));
 if(recipientIds.length!==1||digits(recipientIds[0][0])!==digits(taxId))return null;
 const product=t.split(/DADOS DO PRODUTO\s*\/\s*SERVI.O/);
 if(product.length!==2)return null;
 const section=product[1].split('DADOS ADICIONAIS')[0],months=['JANEIRO','FEVEREIRO','MARCO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
 const periods=Array.from(section.matchAll(/FORNECIDA\s+NO\s+M.S\s+DE\s+([A-Z]+)\/(20\d{2})/g));
 if(periods.length!==1||periods[0][2]+'-'+String(months.indexOf(periods[0][1])+1).padStart(2,'0')!==month||!section.includes('ENERGIA ELETRICA'))return null;
 const decimal='([0-9]{1,3}(?:\\.[0-9]{3})*,[0-9]{2,6}|[0-9]+,[0-9]{2,6})';
 const lines=Array.from(section.matchAll(new RegExp('\\bMWH\\s+'+decimal+'\\s+'+decimal+'\\s+'+decimal,'g')));
 if(lines.length!==1)return null;
 const parse=(s:string)=>s.replace(/\./g,'').replace(',','.');
 const [,q,p,a]=lines[0],quantityMwh=parse(q),pricePerMwh=parse(p),amount=parse(a);
 if(!/^\d+\.\d{2}$/.test(amount)||Number(quantityMwh)<=0||Number(pricePerMwh)<=0)return null;
 const scale=(s:string)=>{const [w,f='']=s.split('.');return BigInt(w)*1000000n+BigInt(f.padEnd(6,'0'));};
 const expected=(scale(quantityMwh)*scale(pricePerMwh)*100n+500000000000n)/1000000000000n;
 if(expected!==scale(amount)/10000n)return null;
 const fatura=t.match(/VALOR\s+ORIGINAL:\s*([\d.,]+),\s*VALOR\s+DO\s+DESCONTO:\s*([\d.,]+),\s*VALOR\s+L.QU[IÍ]DO:\s*([\d.,]+)/);
 if(!fatura||parse(fatura[1])!==amount||Number(parse(fatura[2]))!==0||parse(fatura[3])!==amount)return null;
 return {format:'supplier-invoice-proposal-1',month,quantityMwh,pricePerMwh,amount,...source,nature:'DOCUMENT_PROPOSAL',reviewRequired:true,financialApproval:false,taxTreatment:'UNCONFIRMED',observations:['Nota integral proposta para conferência; não comprova pagamento, isenção ou incidência tributária. Volume comprado preservado separadamente do consumo medido.']};
}

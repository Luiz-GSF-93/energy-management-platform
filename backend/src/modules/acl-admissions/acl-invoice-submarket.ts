// UF is read only from the UC address field, never the distributor/header address.
// Geographic suggestion only: current CCEE modelling and isolated areas need review.
const references=['https://www.ccee.org.br/documents/80415/919464/102%20-%20InfoPLD_Outubro20_versao2.pdf/adcd1358-7fae-91ed-27fb-ea1c8438d33b','https://www.gov.br/mme/pt-br/arquivos/participacao-pdf-0-44349506013790363.pdf'];
const groups:Record<string,string>={};
for(const uf of ['AC','DF','ES','GO','MT','MS','MG','RJ','RO','SP'])groups[uf]='SE_CO';
for(const uf of ['PR','SC','RS'])groups[uf]='S';
for(const uf of ['AL','BA','CE','PB','PE','PI','RN','SE'])groups[uf]='NE';
for(const uf of ['AM','AP','MA','PA','TO'])groups[uf]='N';
export function invoiceSubmarket(address:unknown){
 const result={address:typeof address==='string'?address:null,uf:null as string|null,code:null as string|null,label:null as string|null,status:'PENDING',reviewRequired:true,method:'UC_ADDRESS_UF_SUGGESTION/1',references};
 if(typeof address!=='string'||!address.trim()||address.length>2000)return result;
 const candidates=address.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().split(/\r?\n/).flatMap(line=>{
  const text=line.trim();
  // CEP + city + UF, or a separate city-UF line. Street-only suffixes are rejected.
  const m=text.match(/^[0-9]{5}[- ]?[0-9]{3}\s+.+\s([A-Z]{2})\s*$/)??(!/^(R |RUA |AV |AVENIDA |ESTRADA |RODOVIA )/.test(text)?text.match(/^[A-Z][A-Z .]+\s[-/]\s*([A-Z]{2})(?:\s+[0-9]{5}[- ]?[0-9]{3})?\s*$/):null);
  return m?[m[1]]:[];
 });
 const unique=[...new Set(candidates)];if(unique.length!==1)return result;
 result.uf=unique[0];const code=groups[result.uf];if(!code)return result;
 return {...result,code,label:({SE_CO:'Sudeste / Centro-Oeste',S:'Sul',NE:'Nordeste',N:'Norte'} as Record<string,string>)[code],status:'SUGGESTED'};
}

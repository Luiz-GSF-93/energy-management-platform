// Catalog validation only. No monetary calculation or interpretation of free text.
export function parameterIssues(p:any, rows:any[]):string[]{
 const issues:string[]=[];
 if(p.status==='RETIRED')return ['Parâmetro retirado de uso.'];
 if(p.status!=='APPROVED')issues.push('Parâmetro ainda em rascunho.');
 if(p.kind!=='TAX'){
  if(p.treatment==='GROSS'&&!p.embedded_tax_codes?.length)issues.push('Selecione os códigos dos tributos embutidos.');
  return issues;
 }
 const codes=p.tax_basis?.groupCodes;
 if(codes!=null&&(!Array.isArray(codes)||codes.length>20||new Set(codes).size!==codes.length||codes.some((c:any)=>typeof c!=='string'||!/^(ICMS|PIS|COFINS|IOF|OTHER_[A-Z0-9_]+)$/.test(c))))issues.push('Grupo tributário inválido ou duplicado.');
 if(p.tax_basis?.interaction==='SHARED_INSIDE'&&(p.treatment!=='INSIDE'||!Array.isArray(codes)||codes.length<2||!codes.includes(p.component_code)))issues.push('O grupo por dentro deve incluir este tributo e ao menos outro código.');
 if(Array.isArray(codes)&&codes.length&&p.tax_basis?.interaction!=='SHARED_INSIDE')issues.push('Códigos do grupo exigem a modalidade por dentro conjunta.');
 const tx=p.tax_basis?.taxes;
 if(tx!=null&&(!Array.isArray(tx)||tx.length>20||tx.some((i:any)=>!i||typeof i.parameterId!=='string'||!Number.isInteger(i.revision)||i.revision<1)||new Set(tx.map((i:any)=>i.parameterId)).size!==tx.length))issues.push('Referências tributárias inválidas ou duplicadas.');
 else if(Array.isArray(tx))for(const i of tx){const ref=rows.find(r=>r.id===i.parameterId&&r.id!==p.id&&r.organization_id===p.organization_id&&r.customer_id===p.customer_id&&r.consumer_unit_id===p.consumer_unit_id&&r.scenario===p.scenario&&r.kind==='TAX'&&r.component_code!==p.component_code);
 if(p.tax_basis?.interaction!=='SEQUENTIAL'||!ref||ref.status!=='APPROVED'||ref.revision!==i.revision||!['INSIDE','OUTSIDE'].includes(ref.treatment)||!['INDEPENDENT','SEQUENTIAL','SHARED_INSIDE'].includes(ref.tax_basis?.interaction))issues.push('Selecione tributos aprovados desta unidade e cenário, com regra de interação explícita e revisão atual.');
 else if(ref.start_date.slice(0,10)>p.start_date.slice(0,10)||ref.end_date.slice(0,10)<p.end_date.slice(0,10))issues.push('A vigência de '+ref.label+' não cobre todo o período do tributo.');}
 if(p.tax_basis?.interaction==='SEQUENTIAL'&&(!Array.isArray(tx)||!tx.length))issues.push('Selecione ao menos um tributo na composição sequencial.');
 const items=p.tax_basis?.items;
 if(['EXEMPT','NOT_APPLICABLE'].includes(p.treatment))return issues;
 if(!items?.some((i:any)=>i.operation==='INCLUDE'))return [...issues,'Base estruturada pendente: selecione ao menos uma rubrica incluída.'];
 for(const item of items){
  const ref=rows.find(r=>r.id===item.parameterId&&r.organization_id===p.organization_id&&r.consumer_unit_id===p.consumer_unit_id&&r.scenario===p.scenario&&r.kind!=='TAX');
  if(!ref){issues.push('Uma rubrica da base está indisponível nesta unidade e cenário.');continue;}
  if(ref.status!=='APPROVED'||ref.revision!==item.revision)issues.push('A rubrica '+ref.label+' foi alterada ou retirada de uso. Revise a base.');
  if(ref.start_date.slice(0,10)>p.start_date.slice(0,10)||ref.end_date.slice(0,10)<p.end_date.slice(0,10))issues.push('A vigência de '+ref.label+' não cobre todo o período do tributo.');
  if(item.operation==='INCLUDE'&&p.treatment==='INCLUDED'&&(ref.treatment!=='GROSS'||!ref.embedded_tax_codes?.includes(p.component_code)))issues.push('A origem '+ref.label+' não declara este tributo como embutido.');
  if(item.operation==='INCLUDE'&&['INSIDE','OUTSIDE'].includes(p.treatment)&&ref.treatment!=='NET')issues.push('A base '+ref.label+' contém tributos embutidos; é necessário desmembrar os valores antes da apuração.');
 }
 return [...new Set(issues)];
}

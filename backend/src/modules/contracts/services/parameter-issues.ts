// Catalog validation only. No monetary calculation or interpretation of free text.
export function parameterIssues(p:any, rows:any[]):string[]{
 const issues:string[]=[];
 if(p.status==='RETIRED')return ['Parâmetro retirado de uso.'];
 if(p.status!=='APPROVED')issues.push('Parâmetro ainda em rascunho.');
 if(p.kind!=='TAX'){
  if(p.treatment==='GROSS'&&!p.embedded_tax_codes?.length)issues.push('Selecione os códigos dos tributos embutidos.');
  return issues;
 }
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

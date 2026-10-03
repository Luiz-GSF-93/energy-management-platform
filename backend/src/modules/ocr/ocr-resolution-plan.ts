import {createHash} from 'node:crypto';
export const resolutionId=(parts:unknown[])=>{const h=createHash('sha256').update(JSON.stringify(['bot-resolution-1',...parts])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
export function resolutionRateState(candidate:any,rows:any[],start:string,end:string,unit?:any){
 const matches=rows.filter(p=>p.kind==='TARIFF'&&p.scenario==='ACL'&&p.component_code===candidate.component&&p.time_band===candidate.band&&p.status!=='RETIRED'&&p.start_date<=end&&p.end_date>=start);
 const p=matches[0];
 const contextMatches=!unit||['distributor','tariff_group','tariff_subgroup','tariff_modality','state','consumption_class','free_market'].every(k=>(p?.unit_context?.[k]??null)===(unit[k]??null));
 const same=contextMatches&&matches.length===1&&p.start_date===start&&p.end_date===end&&p.amount_text===candidate.amount&&p.measure===candidate.measure&&p.treatment==='GROSS'&&p.source===candidate.source&&Array.isArray(p.embedded_tax_codes)&&p.embedded_tax_codes.length===candidate.taxCodes.length&&candidate.taxCodes.every((c:string)=>p.embedded_tax_codes.includes(c));
 return {state:!matches.length?'MISSING':same?'PRESERVED':'CONFLICT',existing:same?p:null};
}
/** Group symptoms without discarding a finding or claiming the blockers were resolved. */
export function resolutionGroups(findings:any[]){
 const groups=[{key:'parameters',label:'Tarifas e tributos',sections:['Parâmetros','Tributos','Bases tributárias','Bases operacionais']},{key:'monthly',label:'Medições e conciliação de volume',sections:['Medições','Volumes']},{key:'costs',label:'Custos e nota do fornecedor',sections:['Custos mensais','Custos adicionais']},{key:'other',label:'Outras informações',sections:[]}];
 return groups.map(g=>({...g,findings:findings.filter(f=>g.key==='other'?!groups.slice(0,3).some(a=>a.sections.includes(f.section)):g.sections.includes(f.section))})).filter(g=>g.findings.length);
}

import {createHash} from 'node:crypto';
export const resolutionId=(parts:unknown[])=>{const h=createHash('sha256').update(JSON.stringify(['bot-resolution-1',...parts])).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-8'+h.slice(17,20)+'-'+h.slice(20,32);};
/** Complete the tax declaration, including explicit exclusions, without charging taxes again. */
export function resolutionTaxBases(code:string,rates:any[]){
 return rates.filter(r=>r.state==='PRESERVED').map(r=>({parameterId:r.existing.id,revision:r.existing.revision,operation:r.taxCodes.includes(code)?'INCLUDE':'EXCLUDE'}));
}
export function currentResolutionTaxes(existing:any[],bases:any[],provenance:string,marker:string){
 if(existing.length!==2)return existing;
 const draft=existing.find(p=>p.status==='DRAFT'),old=existing.find(p=>p.status==='APPROVED');
 if(!draft||!old||draft.supersedes_parameter_id!==old.id||draft.source!==provenance+' · exclusões completadas do parâmetro '+old.id||!draft.notes?.startsWith(marker)||draft.treatment!=='INCLUDED'||draft.start_date!==old.start_date||draft.end_date!==old.end_date)return existing;
 const items=draft.tax_basis?.items;
 if(draft.tax_basis?.version!==1||!Array.isArray(items)||items.length!==bases.length||new Set(items.map((i:any)=>i.parameterId)).size!==items.length||items.some((i:any)=>!bases.some(b=>b.parameterId===i.parameterId&&b.revision===i.revision&&b.operation===i.operation)))return existing;
 return [draft];
}
/** Only propose omitted exclusions in an unchanged, bot-owned approved declaration. */
export function missingTaxExclusions(v:any,c:any){
 if(v.existing.length!==1||!v.bases.some((b:any)=>b.operation==='INCLUDE'))return false;
 const p=v.existing[0],items=p.tax_basis?.items;
 if(p.status!=='APPROVED'||p.source!==c.provenance||!p.notes?.startsWith(c.marker)||p.treatment!=='INCLUDED'||p.amount_text!=null||p.start_date!==c.period.start||p.end_date!==c.period.end||p.tax_basis?.version!==1||Object.keys(p.tax_basis).some(k=>!['version','items'].includes(k))||!Array.isArray(items)||!items.length||new Set(items.map((i:any)=>i.parameterId)).size!==items.length)return false;
 if(items.some((i:any)=>!v.bases.some((b:any)=>b.parameterId===i.parameterId&&b.revision===i.revision&&b.operation===i.operation)))return false;
 const missing=v.bases.filter((b:any)=>!items.some((i:any)=>i.parameterId===b.parameterId));
 return v.code==='ICMS'&&missing.length===1&&missing.every((b:any)=>b.operation==='EXCLUDE'&&c.rates.some((r:any)=>r.state==='PRESERVED'&&r.component==='TUSD_DEMAND_UNUSED'&&r.existing?.id===b.parameterId));
}
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
 const section=(f:any)=>f.code?.startsWith('COMPOSITION:')&&/^Tributo (ICMS|PIS|COFINS)(?: já)? incluído/.test(f.message??'')?'Tributos':f.code?.startsWith('COMPOSITION:')&&f.message?.startsWith('Fornecedor e medições precisam')?'Medições':f.section;
 return groups.map(g=>({...g,findings:findings.filter(f=>g.key==='other'?!groups.slice(0,3).some(a=>a.sections.includes(section(f))):g.sections.includes(section(f)))})).filter(g=>g.findings.length);
}

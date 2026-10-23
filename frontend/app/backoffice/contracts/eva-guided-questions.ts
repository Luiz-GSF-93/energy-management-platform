export type GuidedQuestion={key:string;unitId:string;section:string;code:string;messages:string[];label:string;suggestions:{label:string;value:unknown;source:string}[]};
const sections:Record<string,string>={costs:'custos da competência',monthly:'medições da fatura',library:'tarifas e tributos ACR',parameters:'tarifas e tributos',supply:'nota e condições do fornecedor',management:'honorários',distributor:'identificação da unidade',source:'fontes pendentes'};
export function guidedQuestions(report:any):GuidedQuestion[]{
 if(!report||report.approvalEligible||!Array.isArray(report.units))return [];
 const roots=new Map<string,GuidedQuestion>();
 const add=(unit:any,section:string,code:string,message:string)=>{
  const key=unit.id+':'+(code==='CCEE_ESTIMATE_REVIEW'?code:section),old=roots.get(key);
  if(old){if(!old.messages.includes(message))old.messages.push(message);return;}
  const pattern=section==='costs'?/^costs:|^supplier:tax/:section==='monthly'?/^consumption|^demand|^reactive/:section==='supply'?/^supplier:/:section==='management'?/^fee:/:/^tariff:|^tax:|^acr:/;
  roots.set(key,{key,unitId:unit.id,section,code,label:code==='CCEE_ESTIMATE_REVIEW'?'Posso conferir os custos CCEE estimados com você?':'Vamos confirmar '+(sections[section]??sections.source)+'?',messages:[message],suggestions:(unit.fields??[]).filter((f:any)=>f.state==='FILLED'&&f.source&&pattern.test(f.key)).slice(0,20).map((f:any)=>({label:f.label??f.key,value:f.value,source:f.source}))});
 };
 for(const unit of report.units){
  const actions=(report.pendingActions??[]).filter((a:any)=>a.unitId===unit.id&&a.message);
  for(const a of actions)add(unit,a.section==='documents'?'supply':sections[a.section]?a.section:'source',a.code,String(a.message));
  const leftovers=(unit.missing??[]).filter((m:any)=>typeof m==='string'&&!actions.some((a:any)=>a.message===m||m.includes(a.message)));
  for(const m of leftovers){const section=/identidade|CNPJ|instalação|unidade diverg/i.test(m)?'distributor':/medição|medições|consumo|demanda/i.test(m)?'monthly':/fornecedor|nota fiscal|NF /i.test(m)?'supply':/CCEE|custo/i.test(m)?'costs':/tribut|tarifa|ICMS|PIS|COFINS|bandeira/i.test(m)?'parameters':/honorário/i.test(m)?'management':'source';add(unit,section,'SOURCE_REVIEW',m);}
 }
 return Array.from(roots.values());
}

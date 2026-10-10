// Preliminary eligibility only. Never grants modules or creates an offer/license.
export const ADVISOR_VERSION = 'catalog-capacity-v1';
export type SalesProfile = {units:number;users:number;freeMarket:string;solar:boolean;buysEnergy:boolean;goals:string[]};
export type CatalogPlan = {id:string;name:string;version:number;active:boolean;max_consumer_units:number;max_users:number;[key:string]:unknown};
const goalModules:Record<string,string[]> = {
 costs:['report_generation'], automation:['bot_energy_rag'], ocr:['document_management','advanced_analytics'],
 free_market:['free_market_management'], multiunit:[], reports:['report_generation'],
 trading:['trading_hub'], documents:['document_management'],
};
export function advisePlan(profile:SalesProfile,plans:CatalogPlan[]){
 const required = new Set<string>();
 for(const goal of profile.goals){
  if(!Object.prototype.hasOwnProperty.call(goalModules,goal))throw new Error('Perfil comercial incompatível.');
  goalModules[goal].forEach(m=>required.add(m));
 }
 if(['yes','partial'].includes(profile.freeMarket))required.add('free_market_management');
 if(profile.buysEnergy)required.add('trading_hub');
 if(!Number.isSafeInteger(profile.units)||profile.units<1||!Number.isSafeInteger(profile.users)||profile.users<1)throw new Error('Perfil comercial incompatível.');
 const eligible=plans.filter(p=>p.active===true&&Number.isSafeInteger(p.version)&&p.version>0&&
  Number.isSafeInteger(p.max_consumer_units)&&p.max_consumer_units>=profile.units&&
  Number.isSafeInteger(p.max_users)&&p.max_users>=profile.users&&
  [...required].every(m=>p[m]===true));
 eligible.sort((a,b)=>a.max_consumer_units-b.max_consumer_units||a.max_users-b.max_users||a.id.localeCompare(b.id));
 const plan=eligible[0];
 const warnings=['Recomendação interna de capacidade; preço, vigência, desconto e condições comerciais exigem proposta própria.'];
 if(profile.solar)warnings.push('Geração solar informada: conferir atendimento específico; o catálogo atual não define elegibilidade de gestão GD.');
 return {engineVersion:ADVISOR_VERSION,status:!plan?'MANUAL_REVIEW':profile.solar?'REVIEW_REQUIRED':'PRELIMINARY',
  requiredModules:[...required].sort(),selectionRule:'Menor capacidade de unidades compatível; desempate por usuários e ID. Não compara preços.',
  plan:plan?{id:plan.id,name:plan.name,version:plan.version,maxUnits:plan.max_consumer_units,maxUsers:plan.max_users}:null,
  reasons:plan?[`Atende ${profile.units} unidades e ${profile.users} usuários.`, 'Contém os módulos associados aos objetivos informados.']:
   ['Nenhum plano ativo atende simultaneamente às quantidades e aos módulos solicitados. Revisar o catálogo ou preparar proposta específica.'],
  warnings};
}

export type CorrectionContext={customerId:string;unitId:string;month:string;message?:string;tab?:string;kind?:string;scenario?:string;component?:string;recordId?:string;drafts?:boolean};
export function correctionTarget(f:{code:string;section:string},base:CorrectionContext):CorrectionContext|null{
 const areas:Record<string,string>={'Medições':'monthly','Custos mensais':'costs','Unidade':'distributor','Parâmetros':'parameters','Tributos':'parameters','Bases tributárias':'parameters','Fornecedor':'supply','Preços':'supply','Volumes':'supply','Honorários':'management','Custos adicionais':'services'};
 const tab=areas[f.section];if(!tab)return null;const target:CorrectionContext={...base,tab};const [code,a,b]=f.code.split(':');
 if(code==='TAX_MISSING'){target.kind='TAX';target.scenario=a;target.component=b;}
 if(code==='TARIFF_MISSING'){target.kind='TARIFF';target.scenario=a;}
 if(['PARAMETER_GAP','PARAMETER_OVERLAP','PARAMETER_SPLIT'].includes(code)){const [scenario,kind,component]=a.split('/');Object.assign(target,{scenario,kind,component});}
 if(code==='DRAFT_PARAMETERS')target.drafts=true;
 if(code==='PARAMETER_ISSUE'||['PRICE_GAP','PRICE_OVERLAP','PRICE_SOURCES','PRICE_SPLIT','INDEX_PENDING','MONTHLY_VOLUME','LOAD_PROFILE','SERVICE_REVIEW'].includes(code))target.recordId=a;
 return target;
}

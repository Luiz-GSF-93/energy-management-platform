export type CorrectionContext={customerId:string;unitId:string;month:string;message?:string;tab?:string;kind?:string;scenario?:string;component?:string;recordId?:string;drafts?:boolean;action?:"reconciliation"};
export function correctionTarget(f:{code:string;section:string;message?:string},base:CorrectionContext):CorrectionContext|null{
 const parts=f.code.split(':');
 if(parts[0]==='SUPPLIER_AUTO'&&parts[1]&&parts[2]==='SPOT_VOLUME_DIFFERENCE')return {...base,tab:'supply',recordId:parts[1],action:'reconciliation'};
 const tax=f.code.startsWith('COMPOSITION:')&&f.message?.match(/^Tributo (ICMS|PIS|COFINS)(?: já)? incluído\b/);
 if(tax&&['ACL','ACR'].includes(parts[1]))return {...base,tab:'parameters',kind:'TAX',scenario:parts[1],component:tax[1]};
 if(f.code.startsWith('COMPOSITION:')&&f.message?.startsWith('Fornecedor e medições precisam'))return {...base,tab:'supply',action:'reconciliation'};
 const areas:Record<string,string>={'Medições':'monthly','Custos mensais':'costs','Unidade':'distributor','Parâmetros':'parameters','Tributos':'parameters','Bases tributárias':'parameters','Bases operacionais':'parameters','Fornecedor':'supply','Preços':'supply','Volumes':'supply','Honorários':'management','Custos adicionais':'services'};
 const tab=areas[f.section];if(!tab)return null;const target:CorrectionContext={...base,tab};const [code,a,b]=f.code.split(':');
 if(code==='TAX_MISSING'){target.kind='TAX';target.scenario=a;target.component=b;}
 if(code==='TARIFF_MISSING'){target.kind='TARIFF';target.scenario=a;}
 if(['PARAMETER_GAP','PARAMETER_OVERLAP','PARAMETER_SPLIT'].includes(code)){const [scenario,kind,component]=a.split('/');Object.assign(target,{scenario,kind,component});}
 if(code==='SUPPLIER_AUTO'&&tab==='supply')target.recordId=a||undefined;
 if(code==='DRAFT_PARAMETERS')target.drafts=true;
 if(code==='PARAMETER_ISSUE'||['PRICE_GAP','PRICE_OVERLAP','PRICE_SOURCES','PRICE_SPLIT','INDEX_PENDING','MONTHLY_VOLUME','LOAD_PROFILE','SERVICE_REVIEW'].includes(code))target.recordId=a;
 return target;
}

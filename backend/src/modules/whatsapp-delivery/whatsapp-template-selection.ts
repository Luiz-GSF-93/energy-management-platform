/** Only approved EnergyOS names may be selected. Unset keeps existing delivery behavior. */
export function customerTemplateName(original:string,env:NodeJS.ProcessEnv=process.env){
 return env.WHATSAPP_TEMPLATE_VERSION==='v2'?original+'_v2':original;
}
export function reportTemplateName(env:NodeJS.ProcessEnv=process.env){
 const name=env.WHATSAPP_REPORT_TEMPLATE;
 return name==='energyos_relatorio_disponivel'||name==='energyos_relatorio_disponivel_v2'?name:null;
}
/** Static login button carries no tenant identifier, financial data or bearer credential. */
export function hasNoRuntimeParameters(components:unknown):boolean{
 if(!Array.isArray(components)||!components.length)return false;
 let bodyCount=0,buttonCount=0;
 const valid=components.every(c=>{
  if(!c||typeof c!=='object')return false;
  if(c.type==='BUTTONS'){
   buttonCount++;
   return Array.isArray(c.buttons)&&c.buttons.length===1&&c.buttons[0]?.type==='URL'
    &&c.buttons[0].url==='https://app.expertenergy.com.br/auth/login'
    &&c.buttons[0].text==='Acessar EnergyOS';
  }
  if(c.type==='BODY')bodyCount++;
  return ['BODY','FOOTER','HEADER'].includes(c.type)&&(!c.format||c.format==='TEXT')
   &&typeof c.text==='string'&&!c.text.includes('{{');
 });
 return valid&&bodyCount===1&&buttonCount<=1;
}

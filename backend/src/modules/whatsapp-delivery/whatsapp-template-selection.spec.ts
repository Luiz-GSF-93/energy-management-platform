import {customerTemplateName,hasNoRuntimeParameters,reportTemplateName} from './whatsapp-template-selection';
describe('WhatsApp V2 compatibility and component safety',()=>{
 const body={type:'BODY',text:'Um relatório está disponível.'};
 const button={type:'URL',text:'Acessar EnergyOS',url:'https://app.expertenergy.com.br/auth/login'};
 it('preserves original selection unless the version is explicitly enabled',()=>{
  expect(customerTemplateName('energyos_lembrete_prazo',{})).toBe('energyos_lembrete_prazo');
  expect(customerTemplateName('energyos_lembrete_prazo',{WHATSAPP_TEMPLATE_VERSION:'v2'})).toBe('energyos_lembrete_prazo_v2');
  for(const name of ['other','energyos_alerta_custos_v2','energyos_relatorio_disponivel_v2/other',''])expect(reportTemplateName({WHATSAPP_REPORT_TEMPLATE:name})).toBeNull();
  expect(reportTemplateName({WHATSAPP_REPORT_TEMPLATE:'energyos_relatorio_disponivel_v2'})).toBe('energyos_relatorio_disponivel_v2');
 });
 it('permits a parameterless message and the exact static login button',()=>{
  expect(hasNoRuntimeParameters([body])).toBe(true);
  expect(hasNoRuntimeParameters([{type:'HEADER',format:'TEXT',text:'EnergyOS'},body,{type:'FOOTER',text:'Powered by Expert Energy'},{type:'BUTTONS',buttons:[button]}])).toBe(true);
 });
 it('rejects dynamic links, other hosts, data links, media, placeholders and ambiguous buttons',()=>{
  for(const url of ['https://app.expertenergy.com.br/auth/login/{{1}}','https://evil.example','https://app.expertenergy.com.br/auth/login?token=secret'])expect(hasNoRuntimeParameters([body,{type:'BUTTONS',buttons:[{...button,url}]}])).toBe(false);
  for(const components of [null,[],[{type:'BODY',text:'{{1}}'}],[body,{type:'HEADER',format:'IMAGE'}],[body,{type:'BUTTONS',buttons:[button,button]}],[body,body],[body,{type:'BUTTONS',buttons:[{type:'QUICK_REPLY',text:'Aceitar'}]}]])expect(hasNoRuntimeParameters(components)).toBe(false);
 });
});

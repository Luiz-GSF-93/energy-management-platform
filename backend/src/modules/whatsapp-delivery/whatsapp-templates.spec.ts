import {customerTemplates,inspectCustomerTemplates} from './whatsapp-templates.service';
describe('Customer template approval metadata',()=>{
 const env={WHATSAPP_ACCESS_TOKEN:'private-test-token',WHATSAPP_BUSINESS_ACCOUNT_ID:'123',WHATSAPP_GRAPH_VERSION:'v26.0'};
 const transport=(body:unknown,status=200)=>jest.fn().mockResolvedValue({ok:status===200,json:async()=>body}) as jest.Mock;
 it('looks up exact V2 names and validates their static login button without accepting the parameterized alert as a customer notice',async()=>{
  const fetcher=jest.fn(async(url:string)=>{const name=new URL(url).searchParams.get('name');return {ok:true,json:async()=>({data:[{name,language:'pt_BR',status:'APPROVED',components:[{type:'BODY',text:name==='energyos_alerta_custos_v2'?'Alerta: {{1}}':'Aviso EnergyOS'},{type:'BUTTONS',buttons:[{type:'URL',text:'Acessar EnergyOS',url:'https://app.expertenergy.com.br/auth/login'}]}]}]})};});
  const result=await inspectCustomerTemplates({...env,WHATSAPP_TEMPLATE_VERSION:'v2'},fetcher as any);
  expect(result.rows.every(r=>r.name.endsWith('_v2')&&r.status==='APPROVED')).toBe(true);
  expect(result.rows[0].parameterless).toBe(false);
  expect(result.rows.slice(1).every(r=>r.parameterless)).toBe(true);
  expect(JSON.stringify(result)).not.toMatch(/private|token|components/);
 });
 it('queries only the configured account and never returns token, bodies or errors',async()=>{
  const fetcher=jest.fn(async(url:string)=>{const name=new URL(url).searchParams.get('name');return {ok:true,json:async()=>({data:[{name,language:'pt_BR',status:'APPROVED',components:'private body'}]})};});
  const result=await inspectCustomerTemplates(env,fetcher as any);
  expect(result.rows.every(row=>row.status==='APPROVED')).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(customerTemplates.length);
  expect(JSON.stringify(result)).not.toMatch(/private|token|components/);
  for(const [url,options] of fetcher.mock.calls as any){expect(url).toContain('/v26.0/123/message_templates?');expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe('Bearer private-test-token');}
 });
 it('does not query missing or malformed credentials and account configuration',async()=>{
  for(const patch of [{WHATSAPP_ACCESS_TOKEN:''},{WHATSAPP_BUSINESS_ACCOUNT_ID:'123/other'},{WHATSAPP_GRAPH_VERSION:'v26.0/other'}]){
   const fetcher=transport({});const result=await inspectCustomerTemplates({...env,...patch},fetcher as any);expect(fetcher).not.toHaveBeenCalled();expect(result.configured).toBe(false);expect(result.rows.every(row=>row.status==='UNAVAILABLE')).toBe(true);
  }
 });
 it('requires an exact unambiguous Portuguese result with a recognized state',async()=>{
  const row={name:customerTemplates[0].name,language:'pt_BR',status:'APPROVED'};
  for(const [body,state] of [
   [{data:[{...row,language:'en_US'}]},'MISSING'],
   [{data:[{...row,name:'other'}]},'MISSING'],
   [{data:[row,row]},'UNKNOWN'],
   [{data:[row],paging:{next:'https://untrusted.example'}},'UNKNOWN'],
   [{data:[{...row,status:'arbitrary'}]},'UNKNOWN'],
   [{data:'bad'},'UNAVAILABLE'],
  ] as const){const result=await inspectCustomerTemplates(env,transport(body) as any);expect(result.rows[0].status).toBe(state);}
 });
 it('reports request failures safely without granting approval or retrying',async()=>{
  for(const fetcher of [transport({error:{message:'private error'}},403),jest.fn().mockRejectedValue(Error('private token'))]){
   const result=await inspectCustomerTemplates(env,fetcher as any);expect(result.rows.every(row=>row.status==='UNAVAILABLE')).toBe(true);expect(fetcher).toHaveBeenCalledTimes(5);expect(JSON.stringify(result)).not.toContain('private');
  }
 });
});

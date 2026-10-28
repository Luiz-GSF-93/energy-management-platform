import {AutomaticIntakeWorker} from './automatic-intake.worker';
describe('Intake continuation uses the live customer/unit grant',()=>{
 it('forwards the exact lease and payload only for scoped continuation RPCs',async()=>{
  const old=process.env.PORTAL_MULTI_CUSTOMER_ENABLED;process.env.PORTAL_MULTI_CUSTOMER_ENABLED='true';
  try{const rpc=jest.fn(async(..._args:any[])=>({data:{ok:true}})),worker=new AutomaticIntakeWorker({getClient:()=>({rpc})} as any,null as any,null as any,null as any,null as any,null as any),args={p_id:'receipt',p_token:'lease',p_action:'prepared',p_body:{complete:true}};
   await (worker as any).rpc('transition_eva_automatic_intake',args);expect(rpc).toHaveBeenLastCalledWith('portal_intake_scoped_rpc',{p_name:'transition_eva_automatic_intake',p_args:args});
   await (worker as any).rpc('claim_eva_automatic_intake',{p_organizations:['org']});expect(rpc).toHaveBeenLastCalledWith('claim_eva_automatic_intake',{p_organizations:['org']});
  }finally{if(old===undefined)delete process.env.PORTAL_MULTI_CUSTOMER_ENABLED;else process.env.PORTAL_MULTI_CUSTOMER_ENABLED=old;}
 });
});

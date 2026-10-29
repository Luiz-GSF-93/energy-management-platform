import {BotReportsService} from './bot-reports.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
describe('EVA authorized-unit consolidated evidence',()=>{
 function fixture(){
  const ids=['a','b'],period={from:'2026-01',to:'2026-04'},t:any={organizationId:'o',userId:'actor',roleId:'r',role:'consulta',permissions:[P.DOCUMENTS_REPORTS_VIEW,P.INTELLIGENCE_AI_USE]};
  const rpc=jest.fn(async(name:string)=>name==='portal_presentation_action'?{data:{organizationId:'o',customerId:'c',units:ids.map(id=>({id})),rows:ids.map(unitId=>({unitId,month:'2026-04',publicationId:unitId,sourceHash:'a'.repeat(64),usageFields:[{key:'consumptionPeak',value:'10'},{key:'consumptionOffPeak',value:'90'}]}))}}:{error:{code:'42501'}});
  const report={customerId:'c',totals:{aclAfterFees:'150.00'},months:[],unitMonthCount:2,rows:[{id:'pub',payloadHash:'a'.repeat(64),month:'2026-04',units:ids.map(id=>({id}))}]};
  const financial={portalFinancial:jest.fn(async()=>report)},details={rows:ids.map(unitId=>({unitId,name:unitId,month:'2026-04',publicationId:'pub',sourceHash:'a'.repeat(64),composition:[{key:'ccee-published-credit',amount:'-1.00',percent:'0.00'}],indicators:[]}))},insights={read:jest.fn(async()=>details)},ai={interpret:jest.fn(async()=>({state:'READY',answer:'Resumo com fontes',evidence:[]}))};
  const s=new BotReportsService({getClient:()=>({rpc})} as any,{} as any,financial as any,{available:async()=>true} as any,{} as any,ai as any,{} as any,{get:()=>false} as any,insights as any);
  return {s,t,ai,financial,insights,report,input:{question:'Qual a economia consolidada?',unitIds:'a,b',...period,kind:'FINANCIAL'}};
 }
 it('passes one authorized consolidated context to IA and rechecks immutable sources',async()=>{const f=fixture();const r=await f.s.ask(f.input,f.t,'client');expect(r.state).toBe('READY');expect(f.ai.interpret).toHaveBeenCalledTimes(1);expect(f.financial.portalFinancial).toHaveBeenCalledTimes(2);expect(f.financial.portalFinancial).toHaveBeenCalledWith({from:'2026-01',to:'2026-04',unitIds:'a,b'},f.t);const proof=JSON.stringify(f.ai.interpret.mock.calls);expect(proof).toContain('-1.00');expect(proof).not.toContain('foreign');});
 it('rejects an unauthorized unit before sending evidence to IA',async()=>{const f=fixture();await expect(f.s.ask({...f.input,unitIds:'a,foreign'},f.t,'client')).rejects.toThrow();expect(f.ai.interpret).not.toHaveBeenCalled();expect(f.financial.portalFinancial).not.toHaveBeenCalled();});
 it('withholds the answer if publications change during interpretation',async()=>{const f=fixture();let count=0;f.financial.portalFinancial.mockImplementation(async()=>++count===1?f.report:{...f.report,rows:[]});await expect(f.s.ask(f.input,f.t,'client')).rejects.toThrow('fontes');});
 it('does not infer a consolidated regulatory answer or payment',async()=>{const f=fixture();const r=await f.s.ask({...f.input,question:'As faturas foram pagas?'},f.t,'client');expect(r.state).toBe('NO_EVIDENCE');expect(f.ai.interpret).not.toHaveBeenCalled();});
});

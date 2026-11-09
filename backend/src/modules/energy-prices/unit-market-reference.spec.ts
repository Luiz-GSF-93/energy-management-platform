import {unitMarketReference} from './unit-market-reference';
import {EnergyPriceService} from './energy-price.service';
describe('registered unit PLD references',()=>{
 it('uses a registered supply submarket independently of contract price coverage',()=>{expect(unitMarketReference('São Paulo',['SE_CO'])).toMatchObject({code:'SE_CO',basis:'REGISTERED_SUPPLY_SUBMARKET'});});
 it('identifies São Paulo as a disclosed geographic chart reference without inventing a contract',()=>{expect(unitMarketReference('São Paulo',[])).toMatchObject({code:'SE_CO',basis:'REGISTERED_STATE_REFERENCE'});expect(unitMarketReference('SP',[]).code).toBe('SE_CO');});
 it('does not resolve conflicting modelled markets or isolated/unknown locations by guess',()=>{expect(unitMarketReference('SP',['S','SE_CO']).code).toBeNull();expect(unitMarketReference('Amazonas',[]).code).toBeNull();expect(unitMarketReference(null,[]).code).toBeNull();});
 it.each([false,true])('returns real PLD and spread references in the authorized audience, portal=%s',async portal=>{
  process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED='true';const filters:any[]=[],org='org-a',customer='customer',unit='11111111-1111-4111-8111-111111111111';
  const data={customerId:customer,units:[{id:unit,name:'Registered unit',customerId:customer,customerName:'Synthetic'}],baselines:[],studies:[],financial:[],submarkets:[],pld:[{month:'2026-01',submarket:'SE_CO',value:'100.000000',publishedAt:'2026-02-01T12:00:00Z'}]};
  const client={rpc:jest.fn(async(name:string)=>({error:null,data:name==='energy_price_read_workspace'?structuredClone(data):[]})),from:(table:string)=>{const q:any={select:()=>q,eq:(k:string,v:any)=>{filters.push([table,k,v]);return q;},in:(k:string,v:any)=>{filters.push([table,k,v]);return q;},then:(resolve:any)=>resolve({error:null,data:table==='consumer_units'?[{id:unit,organization_id:org,customer_id:customer,state:'São Paulo'}]:[]})};return q;}};
  const service=new EnergyPriceService({getClient:()=>client} as any,{requireEntitlement:jest.fn().mockResolvedValue(true)} as any);
  const result=await service.read({year:'2026'}, {organizationId:org,userId:'actor',roleId:'role',role:portal?'consulta':'admin_org',scope:'organization'} as any,portal);
  expect(result.months[0]).toMatchObject({pld:'100.00',pldSpread5:'105.00',pldSpread10:'110.00',pldSpread15:'115.00'});
  expect(result.months[0].pldSubmarketSources[0]).toMatchObject({unitId:unit,basis:'REGISTERED_STATE_REFERENCE'});
  expect(filters).toContainEqual(['consumer_units','organization_id',org]);expect(filters).toContainEqual(['consumer_units','customer_id',customer]);expect(filters).toContainEqual(['consumer_units','id',[unit]]);
 });
 afterEach(()=>{delete process.env.PORTAL_FINANCIAL_DETAIL_V2_ENABLED;});
});

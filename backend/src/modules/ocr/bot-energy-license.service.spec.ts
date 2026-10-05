import {BotEnergyLicenseService} from './bot-energy-license.service';
describe('Bot-Energy license gate',()=>{
 it('queries current license without cache and rejects zero/expired/ambiguous quotas',async()=>{const rpc=jest.fn().mockResolvedValue({data:10000000,error:null});const s=new BotEnergyLicenseService({getClient:()=>({rpc})} as any);expect(await s.available('a')).toBe(true);rpc.mockResolvedValue({data:0,error:null});expect(await s.available('a')).toBe(false);expect(rpc).toHaveBeenCalledTimes(2);});
 it('fails closed when the durable licensing service is unavailable',async()=>{const s=new BotEnergyLicenseService({getClient:()=>({rpc:async()=>({error:{code:'offline'}})})} as any);await expect(s.available('a')).rejects.toThrow('Licença');expect(await s.available('')).toBe(false);});
});

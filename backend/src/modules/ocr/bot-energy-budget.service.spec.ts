import {BotEnergyBudgetService} from './bot-energy-budget.service';
describe('Azure price completeness',()=>{
 const keys=['BOT_ENERGY_AZURE_PRICES_VERIFIED','BOT_ENERGY_AZURE_CHAT_INPUT_USD_PER_MILLION','BOT_ENERGY_AZURE_CHAT_OUTPUT_USD_PER_MILLION'];
 const saved=keys.map(k=>process.env[k]);
 afterEach(()=>keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];}));
 it.each([undefined,'','   '])('rejects an absent chat output price (%s) before reserving or calling Azure',async value=>{
  process.env.BOT_ENERGY_AZURE_PRICES_VERIFIED='true';process.env.BOT_ENERGY_AZURE_CHAT_INPUT_USD_PER_MILLION='0.2';
  if(value===undefined)delete process.env.BOT_ENERGY_AZURE_CHAT_OUTPUT_USD_PER_MILLION;else process.env.BOT_ENERGY_AZURE_CHAT_OUTPUT_USD_PER_MILLION=value;
  const getClient=jest.fn();const service=new BotEnergyBudgetService({getClient} as any);
  await expect(service.reserve('org','actor','request','conversation',{inputTokens:100,outputTokens:100})).rejects.toThrow('Preços Azure');expect(getClient).not.toHaveBeenCalled();
 });
});

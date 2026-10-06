import {entryIssues,entryPayload} from './entry-drafts';
const customer='00000000-0000-4000-8000-000000000001';
const base={name:'U',code:'1',distributor:'D',tariffGroup:'A',tariffSubgroup:'A4',tariffModality:'GREEN'};
describe('independent classification in distributor drafts',()=>{
 it.each([[false,true,true],[true,true,false],[null,null,null]])('preserves market %s, GD %s and BESS %s', (freeMarket,hasGd,hasBess)=>{
  const p=entryPayload('distributor',customer,{...base,customerId:'other',freeMarket,hasGd,hasBess});
  expect(p).toMatchObject({customerId:customer,freeMarket,hasGd,hasBess});
  expect(entryIssues('distributor',p)).toEqual([]);
 });
 it.each(['freeMarket','hasGd','hasBess'])('rejects string booleans for %s',key=>{
  expect(entryIssues('distributor',entryPayload('distributor',customer,{...base,[key]:'false'}))).toContain(key);
 });
 it('does not infer absent technologies',()=>{
  const p=entryPayload('distributor',customer,base);
  expect(p.hasGd).toBeUndefined();expect(p.hasBess).toBeUndefined();
 });
});

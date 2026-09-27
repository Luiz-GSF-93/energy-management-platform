import {reconcileDemand} from './demand-reconciliation';
const history={state:'COVERED_VALIDATED',periods:[{id:'p',validation:'VALIDATED',modality:'GREEN',single:'500'}]};
const row=(decimal:string,source:string)=>({decimal,source,state:'BILLED_UNCLASSIFIED',unit:'kW'});
const demand={billed:[row('234.6400','a'),row('265.3600','b')]};
describe('Demand arithmetic reconciliation',()=>{
 it('matches independently registered contract exactly without classifying lines',()=>{const copy=JSON.stringify(demand);expect(reconcileDemand(demand,history)).toMatchObject({state:'MATCH',contracted:'500',billedTotal:'500',difference:'0',canImport:false,sources:['a','b']});expect(JSON.stringify(demand)).toBe(copy);});
 it('detects excess and deficit with signed difference',()=>{expect(reconcileDemand({billed:[row('501.000001','a')]},history)).toMatchObject({state:'DIFFERENCE',difference:'1.000001'});expect(reconcileDemand({billed:[row('499.999999','a')]},history).difference).toBe('-0.000001');});
 it('retains exact precision at large values',()=>expect(reconcileDemand({billed:[row('999999999999.000001','a')]},{...history,periods:[{...history.periods[0],single:'999999999999'}]}).difference).toBe('0.000001'));
 it.each(['MISSING','UNAVAILABLE','GAP','SPLIT','COVERED_REFERENCE'])('blocks history %s',state=>expect(reconcileDemand(demand,{...history,state})).toMatchObject({state:'BLOCKED',billedTotal:null,canImport:false}));
 it('rejects pending approval and multiple periods',()=>{expect(reconcileDemand(demand,{...history,periods:[{...history.periods[0],validation:'PENDING'}]}).state).toBe('BLOCKED');expect(reconcileDemand(demand,{...history,periods:[...history.periods,...history.periods]}).state).toBe('BLOCKED');});
 it('never sums blue demands',()=>expect(reconcileDemand(demand,{...history,periods:[{...history.periods[0],modality:'BLUE'}]}).state).toBe('BLOCKED'));
 it.each([null,'-1','NaN','1e3','1.1234567',500])('rejects invalid contract %p',single=>expect(reconcileDemand(demand,{...history,periods:[{...history.periods[0],single}]}).state).toBe('BLOCKED'));
 it.each([{decimal:null},{decimal:'1e3'},{decimal:'-1'},{decimal:'1.1234567'},{unit:'kWh'},{state:'CONFLICT'},{source:''}])('rejects unreliable billed line %p',change=>expect(reconcileDemand({billed:[{...row('500','a'),...change}]},history).state).toBe('BLOCKED'));
 it('rejects duplicates and no rows',()=>{expect(reconcileDemand({billed:[row('250','a'),row('250','a')]},history).state).toBe('BLOCKED');expect(reconcileDemand({billed:[]},history).state).toBe('BLOCKED');});
 it('does not use rounded measured demands to infer unused demand',()=>expect(reconcileDemand({...demand,measured:[{decimal:'235'}]},history)).not.toHaveProperty('unused'));
});

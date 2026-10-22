import {consolidatePublishedComposition as sum} from './portal-composition-summary';
describe('published composition consolidation',()=>{
 it('sums exact cents and recalculates weighted percentages instead of averaging percentages',()=>{
  const result=sum([{composition:[{key:'energy',label:'Energia',amount:'0.10'},{key:'tax',label:'ICMS',amount:'0.20'}]},{composition:[{key:'energy',label:'Energia',amount:'0.20'},{key:'tax',label:'ICMS',amount:'0.50'}]}]);
  expect(result).toEqual([{key:'energy',label:'Energia',amount:'0.30',percent:'30.00',offset:'0.00'},{key:'tax',label:'ICMS',amount:'0.70',percent:'70.00',offset:'30.00'}]);
 });
 it('does not turn absent, negative or incompatible source components into zero',()=>{
  expect(sum([])).toBeNull();expect(sum([{composition:null}])).toBeNull();expect(sum([{composition:[{key:'tax',label:'ICMS',amount:'-1.00'}]}])).toBeNull();
  expect(sum([{composition:[{key:'tax',label:'ICMS',amount:'1.00'}]},{composition:[{key:'tax',label:'Tributos não segregados',amount:'2.00'}]}])).toBeNull();
 });
 it('retains tax and CCEE categories and makes displayed shares total exactly 100%',()=>{
  const r=sum([{composition:['distributor','icms','pis','cofins','supplier','fees','ccee'].map(key=>({key,label:key,amount:'1.00'}))}])!;
  expect(r.map(p=>p.key)).toContain('ccee');expect(r.reduce((n,p)=>n+Math.round(Number(p.percent)*100),0)).toBe(10000);
 });
});

it('consolidates mixed historical tax detail at the common gross invoice level without dropping taxes',()=>{
 const r=sum([{composition:[{key:'distributor',label:'Distribuidora sem tributos',amount:'85.00'},{key:'icmsAmount',label:'ICMS',amount:'10.00'},{key:'pisAmount',label:'PIS',amount:'2.00'},{key:'cofinsAmount',label:'COFINS',amount:'3.00'},{key:'supplier',label:'Energia segregada',amount:'40.00'}]},{composition:[{key:'distributor',label:'Fatura da distribuidora',amount:'100.00'},{key:'supplier',label:'Energia do fornecedor',amount:'40.00'}]}]);
 expect(r?.map(p=>p.amount)).toEqual(['200.00','80.00']);expect(r?.[0].label).toContain('tributos incluídos');
});

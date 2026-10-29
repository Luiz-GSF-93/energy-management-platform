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

it('preserves known tax slices and keeps undetailed historical invoices in a separate gross category',()=>{
 const r=sum([{composition:[{key:'distributor',label:'Distribuidora sem tributos',amount:'85.00'},{key:'icmsAmount',label:'ICMS',amount:'10.00'},{key:'pisAmount',label:'PIS',amount:'2.00'},{key:'cofinsAmount',label:'COFINS',amount:'3.00'},{key:'supplier',label:'Energia segregada',amount:'40.00'}]},{composition:[{key:'distributor',label:'Fatura da distribuidora',amount:'100.00'},{key:'supplier',label:'Energia do fornecedor',amount:'40.00'}]}]);
 expect(r?.find(p=>p.key==='icmsAmount')?.amount).toBe('10.00');expect(r?.find(p=>p.key==='distributorUnsegregated')?.amount).toBe('100.00');expect(r?.reduce((n,p)=>n+Math.round(Number(p.amount)*100),0)).toBe(28000);
});

it('consolidates fully and partially segregated supplier publications without losing demonstrated ICMS',()=>{
 const row=(label:string)=>({composition:[{key:'distributor',label:'Distribuidora',amount:'85.00'},...['icmsAmount','pisAmount','cofinsAmount'].map(key=>({key,label:key,amount:'5.00'})),{key:'supplier',label,amount:'32.80'},{key:'icmsSupplierAmount',label:'ICMS fornecedor',amount:'7.20'}]});
 const result=sum([row('Sem ICMS'),row('ICMS regular segregado; adicionais publicados')]);expect(result?.find(p=>p.key==='supplier')?.amount).toBe('65.60');expect(result?.find(p=>p.key==='icmsSupplierAmount')?.amount).toBe('14.40');expect(result?.reduce((n,p)=>n+Math.round(Number(p.amount)*100),0)).toBe(28000);
});

it('keeps credits separate across months and conserves net while expense arcs total 100%',()=>{const r=sum([{composition:[{key:'distributor',label:'Distribuidora',amount:'100.00'},{key:'ccee-published',label:'CCEE',amount:'10.00'}]},{composition:[{key:'distributor',label:'Distribuidora',amount:'100.00'},{key:'ccee-published',label:'CCEE',amount:'-5.00'}]}])!;expect(r.find(p=>p.key==='ccee-published-credit')).toMatchObject({amount:'-5.00',percent:'0.00'});expect(r.reduce((n,p)=>n+Math.round(Number(p.amount)*100),0)).toBe(20500);expect(r.reduce((n,p)=>n+Math.round(Number(p.percent)*100),0)).toBe(10000);expect(r.every(p=>Number(p.percent)>=0)).toBe(true);});

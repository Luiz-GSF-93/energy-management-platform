import {cpflDemandPreview as preview} from './cpfl-demand-preview';
const f=(text:string,decimal:string|null=null)=>({text,decimal,issues:[]});
const meter=(period='PEAK',decimal='203'):any=>({source:'meter.'+period,kind:'ACTIVE_DEMAND',period,unit:'kW',issues:[],fields:{reading:f(decimal,decimal),meter:f('123'),period:f(period),quantityKind:f('Demanda Ativa - kW')}});
const billed=(decimal='234.6400'):any=>({source:'bill.'+decimal,component:'DEMAND_BILLED',period:'UNSPECIFIED',role:'CHARGE',issues:[],fields:{quantity:f(decimal,decimal),unit:f('kW'),description:f('Uso Sist. Distr.')}});
describe('CPFL demand distinction',()=>{
 it('preserves displayed readings without adding periods or reconstructing rounded readings',()=>{const r=preview([billed(),billed('265.3600')],[meter(),meter('OFF_PEAK','235')]);expect(r.measured.map(x=>x.decimal)).toEqual(['203','235']);expect(r.billed.map(x=>x.decimal)).toEqual(['234.6400','265.3600']);expect(r.contracted.decimal).toBeNull();expect(r.unused.decimal).toBeNull();expect(r.canImport).toBe(false);});
 it('does not use billed demand when measurement is absent',()=>expect(preview([billed()],[]).measured.every(x=>x.decimal===null)).toBe(true));
 it('rejects duplicate meter candidates even when equal',()=>expect(preview([],[meter(),meter()]).measured[0].state).toBe('CONFLICT'));
 it.each(['-1','1e3','1,2'])('rejects invalid measurement %s',v=>expect(preview([],[meter('PEAK',v)]).measured[0].decimal).toBeNull());
 it('preserves zero',()=>expect(preview([],[meter('PEAK','0')]).measured[0].decimal).toBe('0'));
 it('rejects source ambiguity',()=>{const m=meter();m.fields.period.issues=['UNVERIFIED_SOURCE'];expect(preview([],[m]).measured[0].decimal).toBeNull();});
 it('rejects merged meter cells',()=>{const m=meter();m.issues=['METER_CELL_AMBIGUOUS'];expect(preview([],[m]).measured[0].decimal).toBeNull();});
 it('does not convert unit or assume kw',()=>{const b=billed();b.fields.unit.text='kWh';expect(preview([b],[]).billed[0].decimal).toBeNull();});
 it('rejects unverified billed source',()=>{const b=billed();b.fields.quantity.issues=['UNVERIFIED_SOURCE'];expect(preview([b],[]).billed[0].state).toBe('CONFLICT');});
 it('ignores credits and other components',()=>{const b=billed();b.role='CREDIT';const c=billed();c.component='TUSD_ENERGY';expect(preview([b,c],[]).billed).toHaveLength(0);});
 it('does not mix active energy or unclassified meter periods',()=>{const m=meter();m.kind='ACTIVE_ENERGY';expect(preview([],[m,meter('UNSPECIFIED')]).measured.every(x=>x.decimal===null)).toBe(true);});
});

describe('Demand labels remain source evidence',()=>{
 it('links explicit usage to the source row without approving import',()=>{const r=billed();r.fields.description=f('Uso Sist. Distr. Demanda não utilizada');const result=preview([r],[]);expect(result.billed[0]).toMatchObject({source:r.source,decimal:'234.6400',classification:{kind:'UNUSED_EXPLICIT'}});expect(result.unused.decimal).toBeNull();expect(result.canImport).toBe(false);});
 it('does not label an invalid quantity',()=>{const r=billed('invalid');r.fields.description=f('Demanda utilizada');expect(preview([r],[]).billed[0].classification.kind).toBe('UNCLASSIFIED');});
});

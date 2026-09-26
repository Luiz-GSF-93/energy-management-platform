import {cpflPreparationPreview as preview} from './cpfl-preparation-preview';
const field=(text:string,decimal:string|null=null,issues:string[]=[])=>({text,decimal,confidence:null,pages:[1],spans:[{offset:0,length:1}],issues});
const row=(period:string,quantity='12.3456',component='TUSD_ENERGY'):any=>({source:component+period,component,period,role:'CHARGE',fields:{quantity:field(quantity,quantity),unit:field('kWh')},issues:[]});
describe('CPFL preparation preview',()=>{
 it('uses exact billed decimals rather than history or provider floats',()=>{const r=preview([row('PEAK'),row('OFF_PEAK','100.1234')]);expect(r.values.map(v=>v.decimal)).toEqual(['12.3456','100.1234','112.4690']);expect(r.canImport).toBe(false);});
 it('compares TE with TUSD instead of adding both',()=>{const r=preview([row('PEAK'),row('OFF_PEAK','10'),row('PEAK','12.345600','TE'),row('OFF_PEAK','10.00','ACL_DISTRIBUTOR_INFORMATION')]);expect(r.values[2].decimal).toBe('22.3456');});
 it('does not choose a duplicate even if quantities agree',()=>{const r=preview([row('PEAK'),row('PEAK'),row('OFF_PEAK')]);expect(r.values[0]).toMatchObject({decimal:null,state:'CONFLICT'});expect(r.values[2].decimal).toBeNull();});
 it('blocks contradictory energy quantity',()=>expect(preview([row('PEAK'),row('PEAK','13','TE')]).values[0]).toMatchObject({decimal:null,state:'CONFLICT'}));
 it.each(['kW','MWh',''])('does not guess or convert unit %s',unit=>{const r=row('PEAK');r.fields.unit.text=unit;expect(preview([r]).values[0].decimal).toBeNull();});
 it.each(['-12','1e3','1,20'])('rejects invalid decimal %s',q=>expect(preview([row('PEAK',q)]).values[0].decimal).toBeNull());
 it('preserves zero without treating it as missing',()=>expect(preview([row('PEAK','0'),row('OFF_PEAK','0')]).values[2].decimal).toBe('0'));
 it('does not derive total from one period',()=>expect(preview([row('PEAK')]).values[2].decimal).toBeNull());
 it('rejects unverified quantity source',()=>{const r=row('PEAK');r.fields.quantity.issues=['UNVERIFIED_SOURCE'];expect(preview([r]).values[0].decimal).toBeNull();});
 it('rejects unverified cross-check source',()=>{const r=row('PEAK','12.3456','TE');r.fields.quantity.issues=['UNVERIFIED_SOURCE'];expect(preview([row('PEAK'),r]).values[0].decimal).toBeNull();});
 it('does not use credits, demand or unknown periods as energy',()=>{const r=row('PEAK');r.role='CREDIT';expect(preview([r,row('UNSPECIFIED'),row('OFF_PEAK','12','DEMAND_BILLED')]).values.every(v=>v.decimal===null)).toBe(true);});
 it('never loses precision through Number',()=>expect(preview([row('PEAK','999999999999999999.000001'),row('OFF_PEAK','0.000009')]).values[2].decimal).toBe('999999999999999999.000010'));
});

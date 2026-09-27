import {OcrTusdIntegrationService} from './ocr-tusd-integration.service';
import {PERMISSIONS as P} from '../../common/constants/permissions';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {tusdParameterCandidates} from './tusd-parameter-candidates';
jest.mock('./cpfl-paulista-layout',()=>({extractCpflPaulistaLayout:jest.fn()}));
jest.mock('./tusd-parameter-candidates',()=>({tusdParameterCandidates:jest.fn()}));
function setup(){
 (extractCpflPaulistaLayout as jest.Mock).mockReturnValue({layoutId:'cpfl-paulista-a',fields:[{name:'reference',value:{text:'AGO/2026'}}],operations:[],reconciliation:{state:'MATCH'}});
 (tusdParameterCandidates as jest.Mock).mockReturnValue(['PEAK','OFF_PEAK'].map(band=>({band,ready:true,source:band,rateKwh:'0.21265684',rateMwh:'212.65684',quantity:'99743.5600',amount:'21211.15'})));
 const f=(key:string)=>({key,sourceHash:'a'.repeat(64),state:'EXTRACTED_REVIEW',history:[{id:key,sourceHash:'a'.repeat(64),decision:'CONFIRMED',version:1}]});
 const identity={fields:['customer','taxId','unit','address','period','market'].map(f)},consumption={fields:['consumptionPeakKwh','consumptionOffPeakKwh','consumptionTotalKwh'].map(f)};
 const data:any={consumer_units:{id:'unit',status:'ACTIVE',free_market:true,tariff_group:'A'},calculation_parameters:[]},calls:any[]=[],insert=jest.fn((rows:any[])=>{data.calculation_parameters.push(...rows);return {select:async()=>({data:rows.map(r=>({id:r.id})),error:null})};});
 const from=(table:string)=>{const q:any={insert};for(const method of ['select','eq','range'])q[method]=(...args:any[])=>{calls.push([table,method,...args]);return q;};q.maybeSingle=async()=>({data:data[table],error:null});q.then=(resolve:any)=>resolve({data:data[table],error:null});return q;};
 const source={doc:{id:'doc',consumer_unit_id:'unit',customer_id:'customer',reference_month:'2026-08-01',file_hash:'a'.repeat(64)},jobId:'job',raw:{}},license={requireEntitlement:jest.fn(async()=>{})};
 const service=new OcrTusdIntegrationService({getClient:()=>({from})} as any,license as any,{reviewSource:async()=>source} as any,{list:async()=>identity} as any,{list:async()=>consumption} as any);
 const t:any={organizationId:'org',userId:'actor',role:'gestor',permissions:[P.DOCUMENTS_VIEW,P.ORGANIZATION_CONTRACTS_VIEW,P.ORGANIZATION_CONTRACTS_CREATE]};return {service,t,source,data,insert,calls,identity,license};
}
describe('TUSD integration',()=>{
 it('creates one atomic draft batch with real author and invoice provenance',async()=>{const s=setup(),p=await s.service.preview('doc',s.t);expect(p.canCreate).toBe(true);await s.service.create('doc',s.t,{token:p.token});expect(s.insert).toHaveBeenCalledTimes(1);const rows=s.insert.mock.calls[0][0];expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',status:'DRAFT',measure:'BRL_MWH',amount_text:'212.65684',created_by:'actor',updated_by:'actor',treatment:'GROSS',embedded_tax_codes:['ICMS','PIS','COFINS'],start_date:'2026-08-01',end_date:'2026-08-31'});expect(rows[0].source).toContain(s.source.doc.file_hash);expect(rows[0].notes.length).toBeLessThan(4097);expect(s.calls).toContainEqual(['consumer_units','eq','customer_id','customer']);expect(s.calls).toContainEqual(['calculation_parameters','eq','organization_id','org']);await s.service.create('doc',s.t,{token:p.token});expect(s.insert).toHaveBeenCalledTimes(1);});
 it('rejects stale evidence and browser supplied financial data',async()=>{const s=setup(),p=await s.service.preview('doc',s.t);s.source.doc.file_hash='b'.repeat(64);await expect(s.service.create('doc',s.t,{token:p.token})).rejects.toThrow('prévia mudou');await expect(s.service.create('doc',s.t,{token:p.token,amount:'1'})).rejects.toThrow();expect(s.insert).not.toHaveBeenCalled();});
 it('preserves manual records',async()=>{const s=setup();s.data.calculation_parameters=[{id:'manual',status:'DRAFT',start_date:'2026-08-01',end_date:'2026-08-31'}];expect((await s.service.preview('doc',s.t)).state).toBe('EXISTING_RECORD');expect(s.insert).not.toHaveBeenCalled();});
 it('requires current confirmations, active ACL group A and license',async()=>{const s=setup();s.identity.fields[0].history=[];expect((await s.service.preview('doc',s.t)).canCreate).toBe(false);s.license.requireEntitlement.mockRejectedValueOnce(new Error('license'));await expect(s.service.preview('doc',s.t)).rejects.toThrow('license');});
 it('denies unauthorized roles and reads',async()=>{const s=setup();await expect(s.service.create('doc',{...s.t,role:'operador'},{token:'a'.repeat(64)})).rejects.toThrow();await expect(s.service.preview('doc',{...s.t,permissions:[]})).rejects.toThrow();expect(s.insert).not.toHaveBeenCalled();});
});

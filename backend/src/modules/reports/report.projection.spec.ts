import {projectReport,reportHash} from './report.projection';
const h={organizationId:'o',customerId:'c',unitId:'u',customerName:'Empresa',unitName:'Unidade'};
const p={id:'g',customerId:'c',month:'2026-08',version:2,payloadHash:'a'.repeat(64),publishedAt:'2026-09-01',units:[{id:'u'}],publicationNote:'INTERNAL SECRET',reservations:['INTERNAL']};
const primary={totals:{acr:'100.00',aclAfterFees:'90.00',savingsAfterFees:'10.00'},publicationCount:1,publications:[p],invoices:[{unitId:'u',groupId:'g',payloadHash:p.payloadHash,month:'2026-08',version:2,measurements:{measurements:{consumptionTotal:'51.877714'},source:'INTERNAL'},reservations:['INTERNAL'],warnings:[],findings:[],scenarios:[{scenario:'ACL',distributor:'40.00',supplier:'50.00',additional:'0.00',taxes:'0.00',subtotal:'90.00',entries:[{source:'INTERNAL'}]}]}],period:{from:'2026-08',to:'2026-09',unitId:'u'},coverage:{missingMonths:['2026-09']},months:[{month:'2026-08',totals:{acr:'100.00'},cumulative:'10.00',widths:{acr:'100.00'}}],unavailable:['ROI indisponível'],disclosure:'Publicado'};
describe('recipient-safe published report',()=>{
 it('preserves exact consumption and source version without internal narratives',()=>{const b=projectReport({primary},h,'OPERATIONAL',[],'2026-10-06');expect(b.invoices[0].consumptionKwh).toBe('51.877714');expect(JSON.stringify(b)).not.toContain('INTERNAL');expect(b.publications[0].version).toBe(2);expect(b.coverage.missingMonths).toEqual(['2026-09']);});
 it('keeps missing measurements unavailable',()=>{const b=projectReport({primary:{...primary,invoices:[{...primary.invoices[0],measurements:null}]}},h,'EXECUTIVE',[],'2026-10-06');expect(b.invoices[0].consumptionKwh).toBeNull();expect(b.roi).toBeNull();expect(b.annualProjection).toBeNull();});
 it('rejects source from another unit',()=>expect(()=>projectReport({primary}, {...h,unitId:'other'},'EXECUTIVE',[],'2026-10-06')).toThrow());
 it('rejects an untraceable publication',()=>expect(()=>projectReport({primary:{...primary,publications:[{...p,publishedAt:null}]}},h,'EXECUTIVE',[],'2026-10-06')).toThrow());
 it('hashes canonically across database JSON key ordering',()=>{expect(reportHash({b:1,a:{d:4,c:3}})).toBe(reportHash({a:{c:3,d:4},b:1}));expect(reportHash({b:1,a:2})).not.toBe(reportHash({b:2,a:2}));});
});
import {withPublishedReportConsumption} from './report-consumption';
const body=()=>({header:{customerId:'c',unitId:'u'},invoices:[{groupId:'g',month:'2026-01',payloadHash:'a'.repeat(64),consumptionKwh:null,financial:'PRESERVED'}]});
const row=()=>({publicationId:'g',month:'2026-01',sourceHash:'a'.repeat(64),customerId:'c',unitId:'u',privateNote:'INTERNAL',fields:[{key:'consumptionTotal',value:'105223.6617'},{key:'consumptionPeak',value:'10000.0001'},{key:'consumptionOffPeak',value:'95223.6616'}]});
describe('exact published consumption in current reports',()=>{
 it('fills EVA totals and bands without modifying financial values or original snapshots',()=>{const original=body(),result=withPublishedReportConsumption(original,[row()]);expect(result.invoices[0]).toMatchObject({consumptionKwh:'105223.6617',peakKwh:'10000.0001',offPeakKwh:'95223.6616',financial:'PRESERVED'});expect(original.invoices[0].consumptionKwh).toBeNull();expect(JSON.stringify(result)).not.toContain('INTERNAL');});
 it.each(['sourceHash','customerId'])('rejects a mismatching %s for the same publication',key=>{expect(()=>withPublishedReportConsumption(body(),[{...row(),[key]:'different'}])).toThrow('publicação mudou');});
 it.each(['publicationId','unitId','month'])('never borrows a different %s',key=>{expect(withPublishedReportConsumption(body(),[{...row(),[key]:'other'}]).invoices[0].consumptionKwh).toBeNull();});
 it('rejects duplicates rather than selecting an arbitrary source',()=>{expect(()=>withPublishedReportConsumption(body(),[row(),row()])).toThrow('ambígua');const r=row();r.fields.push(r.fields[0]);expect(()=>withPublishedReportConsumption(body(),[r])).toThrow('duplicadas');});
 it('preserves the total when bands do not reconcile, without inventing a remainder',()=>{const r=row();r.fields[2].value='95223.6615';expect(withPublishedReportConsumption(body(),[r]).invoices[0]).toMatchObject({consumptionKwh:'105223.6617',peakKwh:null,offPeakKwh:null});});
 it('rejects divergence from an existing total',()=>{const b:any=body();b.invoices[0].consumptionKwh='100';expect(()=>withPublishedReportConsumption(b,[row()])).toThrow('divergente');});
 it('does not turn missing or zero total into a filled reading',()=>{const r=row();r.fields[0].value='0';expect(withPublishedReportConsumption(body(),[r]).invoices[0].consumptionKwh).toBeNull();expect(()=>withPublishedReportConsumption(body(),null)).toThrow('indisponíveis');});
});


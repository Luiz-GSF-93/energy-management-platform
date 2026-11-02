import {normalizePublishedDetail} from './portal-legacy-detail';
import {clientPublishedInsight} from './portal-insights.model';
import {reviewDigest} from '../contracts/services/review-snapshots.service';
import {energyPriceDashboard} from '../energy-prices/energy-price-dashboard';
const fixture=()=>{const p:any={formatVersion:'financial-settlement-1.0',sources:{organizationId:'org',customerId:'customer',month:'2026-08'},financial:{status:'AVAILABLE',units:[{id:'unit',acr:'200.00',aclBeforeFees:'145.00',aclAfterFees:'155.00',totalFees:'10.00'}]},preparations:{unit:{operationalComposition:{scenarios:[{scenario:'ACL',status:'AVAILABLE',distributor:'100.00',supplier:'40.00',additional:'0.00',taxes:'5.00',subtotal:'145.00',entries:[{id:'supplier-icms',group:'TAX',label:'ICMS fornecedor',amount:'5.00',source:'Private approved source',revision:1}]}]}}}};return {legacyPayload:p,legacyHash:reviewDigest(p),customerId:'customer',month:'2026-08',unitId:'unit',publicationId:'pub',name:'Unit'};};
describe('historical published composition',()=>{
 it('retains already published additional supplier ICMS instead of losing the whole annual chart',()=>{const row=normalizePublishedDetail(fixture(),'org'),r=clientPublishedInsight(row,true);expect(r.composition?.map(p=>p.amount)).toEqual(['100.00','40.00','10.00','5.00']);expect(r.composition?.find(p=>p.key==='tax-published')?.label).toBe('Tributos adicionais publicados');expect(JSON.stringify(r)).not.toContain('Private approved source');});
 it('rejects a changed historical payload and never adds an unproved balancing expense',()=>{const f=fixture();f.legacyPayload.preparations.unit.operationalComposition.scenarios[0].taxes='6.00';expect(()=>normalizePublishedDetail(f,'org')).toThrow();const g=fixture();g.legacyPayload.preparations.unit.operationalComposition.scenarios[0].entries=[];g.legacyHash=reviewDigest(g.legacyPayload);expect(clientPublishedInsight(normalizePublishedDetail(g,'org'),true).composition).toBeNull();});
});

function priceFixture(){
 const f=fixture(),p=f.legacyPayload,prep=p.preparations.unit;
 prep.measurements={validatedVersion:{measurements:{consumptionTotal:'1000',consumptionPeak:'100',consumptionOffPeak:'900'}}};
 prep.tariffPreview={mode:'TARIFF_COMPONENT_PREVIEW',pending:[],lines:[
  {parameterId:'te-p',revision:2,scenario:'ACR',component:'TE',timeBand:'PEAK',measure:'BRL_KWH',quantity:'100',quantityUnit:'kWh',rate:'0.4',amount:'40.00',treatment:'NET',embeddedTaxCodes:[],source:'Frozen approved TE reference'},
  {parameterId:'te-o',revision:2,scenario:'ACR',component:'TE',timeBand:'OFF_PEAK',measure:'BRL_KWH',quantity:'900',quantityUnit:'kWh',rate:'0.25',amount:'225.00',treatment:'NET',embeddedTaxCodes:[],source:'Frozen approved TE reference'}
 ]};
 prep.operationalComposition.scenarios.push({scenario:'ACR',status:'AVAILABLE',blockers:[],entries:prep.tariffPreview.lines.map((l:any)=>({id:l.parameterId,revision:l.revision,group:'DISTRIBUTOR',amount:l.amount,source:l.source}))});
 f.legacyHash=reviewDigest(p);return f;
}
describe('published historical TE in the monthly price chart',()=>{
 it('uses the frozen net TE for its own month, without changing the published settlement',()=>{
  const f=priceFixture(),before=JSON.stringify(f),normalized=normalizePublishedDetail(f,'org'),insight=clientPublishedInsight(normalized,true);
  expect(insight.prices).toMatchObject({acrNet:'265.00',kwh:'1000',aclObserved:'40.00'});
  expect(JSON.stringify(f)).toBe(before);expect(JSON.stringify(insight)).not.toContain('Frozen approved TE reference');
  const result=energyPriceDashboard('org',2026,{customerId:'customer',workspaceV2:true,units:[{id:'unit',name:'Unit',customerId:'customer',customerName:'Customer'}],studies:[],baselines:[],financial:[],evaDetails:[insight],submarkets:[{unitId:'unit',month:'2026-08',submarket:'SE_CO'}],pld:[{month:'2026-08',submarket:'SE_CO',value:'100'}]},true);
  expect(result.months[7]).toMatchObject({acr:'265.00',acl:'40.00',pld:'100.00',scorePercent:null});
  expect(result.months[6].acr).toBeNull();expect(result.months[8].acr).toBeNull();
 });
 it.each(['GROSS','UNKNOWN'])('does not label %s TE as net',treatment=>{const f=priceFixture();f.legacyPayload.preparations.unit.tariffPreview.lines[0].treatment=treatment;f.legacyHash=reviewDigest(f.legacyPayload);expect(clientPublishedInsight(normalizePublishedDetail(f,'org'),true).prices.acrNet).toBeNull();});
 it.each(['mismatch','duplicate','incomplete-volume','unpublished-line','revision','pending','mixed-tax','wrong-quantity-unit'])('preserves missing evidence instead of inventing a reference: %s',kind=>{
  const f=priceFixture(),prep=f.legacyPayload.preparations.unit,l=prep.tariffPreview.lines[0];
  if(kind==='mismatch')l.rate='0.45';
  if(kind==='duplicate')prep.tariffPreview.lines.push({...l});
  if(kind==='incomplete-volume')prep.measurements.validatedVersion.measurements.consumptionTotal='1001';
  if(kind==='unpublished-line')prep.operationalComposition.scenarios[1].entries=[];
  if(kind==='revision')prep.operationalComposition.scenarios[1].entries[0].revision=3;
  if(kind==='pending')prep.tariffPreview.pending=[{reason:'TE reference pending'}];
  if(kind==='mixed-tax')l.embeddedTaxCodes=['ICMS'];
  if(kind==='wrong-quantity-unit')l.quantityUnit='MWh';
  f.legacyHash=reviewDigest(f.legacyPayload);expect(clientPublishedInsight(normalizePublishedDetail(f,'org'),true).prices.acrNet).toBeNull();
 });
 it('supports BRL/MWh source tariffs while keeping quantities in kWh',()=>{const f=priceFixture();f.legacyPayload.preparations.unit.tariffPreview.lines.forEach((l:any)=>{l.measure='BRL_MWH';l.rate=l.timeBand==='PEAK'?'400':'250';});f.legacyHash=reviewDigest(f.legacyPayload);expect(clientPublishedInsight(normalizePublishedDetail(f,'org'),true).prices.acrNet).toBe('265.00');});
 it('rejects a different customer or month even when TE cells are present',()=>{const f=priceFixture();expect(()=>normalizePublishedDetail({...f,customerId:'foreign'},'org')).toThrow();expect(()=>normalizePublishedDetail({...f,month:'2026-09'},'org')).toThrow();});
});

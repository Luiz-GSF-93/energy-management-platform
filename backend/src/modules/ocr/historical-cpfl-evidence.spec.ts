import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {selectAutofillLibrary} from './calculation-autofill.model';
const evidence=JSON.parse(readFileSync(join(__dirname,'../../../test/fixtures/aneel-cpfl-a4-verde-2026.json'),'utf8'));
describe('historical official tariff evidence boundaries',()=>{
 it('preserves both official periods and energy/demand units without importing a library',()=>{
  expect(evidence).toMatchObject({automaticImport:false,financialApplication:false,taxTreatment:'UNKNOWN'});
  expect(evidence.rows).toHaveLength(6);
  const old=evidence.rows.filter((r:any)=>r.DatInicioVigencia==='2026-01-01'),next=evidence.rows.filter((r:any)=>r.DatInicioVigencia==='2026-04-24');
  expect(old.every((r:any)=>r.DatFimVigencia==='2026-04-23')).toBe(true);
  expect(old.find((r:any)=>r.NomPostoTarifario==='Fora ponta')).toMatchObject({VlrTUSD:'114,47',VlrTE:'271,19',DscUnidadeTerciaria:'MWh'});
  expect(next.find((r:any)=>r.DscUnidadeTerciaria==='kW').VlrTUSD).toBe('16,53');
 });
 it('does not extend one historical tariff across the April change or use the wrong class',()=>{
  const unit={organization_id:'org',distributor:'CPFL Paulista',tariff_group:'A',tariff_subgroup:'A4',tariff_modality:'GREEN',consumption_class:'INDUSTRIAL'};
  const profile={source:evidence.url,distributor:'CPFL Paulista',group:'A',subgroup:'A4',modality:'GREEN',consumptionClass:'GENERAL',taxTreatment:'NET',items:[{component:'TE',band:'OFF_PEAK',value:'271.19',measure:'BRL_MWH'}]};
  // NET below is an explicit test classification, not an assertion about unreviewed CSV evidence.
  const rows=[{id:'old',organization_id:'org',profile:{...profile,startDate:'2026-01-01',endDate:'2026-04-23'}},{id:'next',organization_id:'org',profile:{...profile,startDate:'2026-04-24',endDate:'2027-04-07'}}];
  expect(selectAutofillLibrary(rows,unit,'2026-03',{taxTreatment:'NET'}).record?.id).toBe('old');
  expect(selectAutofillLibrary(rows,unit,'2026-04',{taxTreatment:'NET'}).record).toBeNull();
  expect(selectAutofillLibrary(rows.map(r=>({...r,profile:{...r.profile,consumptionClass:'COMMERCIAL'}})),unit,'2026-03').record).toBeNull();
 });
 it('reuses one reviewed CPFL A4 NET library across eligible companies while retaining scope and ambiguity checks',()=>{
  const unit={organization_id:'org',distributor:'CPFL Paulista',tariff_group:'A',tariff_subgroup:'A4',tariff_modality:'GREEN',consumption_class:'COMMERCIAL'};
  const profile={source:'Official reviewed reference',distributor:'CPFL Paulista',group:'A',subgroup:'A4',modality:'GREEN',consumptionClass:'GENERAL',taxTreatment:'NET',startDate:'2026-04-24',endDate:'2027-04-07',items:[{component:'TE',band:'OFF_PEAK',value:'271.19',measure:'BRL_MWH'}]};
  const net={id:'net',organization_id:'org',profile},legacy={id:'legacy',organization_id:'org',profile:{...profile,taxTreatment:'UNKNOWN',consumptionClass:'COMERCIAL'}};
  for(const consumption_class of ['COMMERCIAL','INDUSTRIAL','RURAL'])for(const month of ['2026-08','2026-09','2026-10','2027-03'])expect(selectAutofillLibrary([legacy,net],{...unit,consumption_class},month).record?.id).toBe('net');
  expect(selectAutofillLibrary([legacy,net,{...net,id:'another-net'}],unit,'2026-09').state).toBe('AMBIGUOUS');
  for(const patch of [{organization_id:'foreign'},{distributor:'CPFL Piratininga'},{tariff_modality:'BLUE'},{tariff_subgroup:'A3'}])expect(selectAutofillLibrary([net],{...unit,...patch},'2026-09').record).toBeNull();
  expect(selectAutofillLibrary([net],unit,'2027-05').record).toBeNull();
 });

});

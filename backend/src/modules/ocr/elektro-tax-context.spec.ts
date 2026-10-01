import {elektroTaxContext} from './elektro-tax-context';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
import {reactiveParameterCandidates} from './reactive-parameter-candidates';
import {combinedTaxLayout,operationTaxCodes} from './reviewed-layout-support';
jest.mock('./cpfl-paulista-layout');jest.mock('./reactive-parameter-candidates');jest.mock('./reviewed-layout-support');
const codes=['ICMS','PIS','COFINS'];
function setup(){
 const root=' · documento doc · SHA-256 '+'a'.repeat(64),source={raw:{},jobId:'job',doc:{file_hash:'a'.repeat(64),customer_id:'customer',consumer_unit_id:'unit'}},period={start:'2026-08-01',end:'2026-08-31'};
 const common={organization_id:'org',customer_id:'customer',consumer_unit_id:'unit',scenario:'ACL',start_date:period.start,end_date:period.end,status:'APPROVED',revision:2,direction:'DEBIT'};
 const specs=[['TUSD_ENERGY','PEAK','BRL_MWH','OCR fatura'],['TUSD_ENERGY','OFF_PEAK','BRL_MWH','OCR fatura'],['TUSD_DEMAND_USED','ALL','BRL_KW','OCR CPFL'],['TUSD_DEMAND_UNUSED','ALL','BRL_KW','OCR CPFL'],['REACTIVE','OFF_PEAK','BRL_MWH','OCR']];
 const rows:any[]=specs.map(([component_code,time_band,measure,prefix],i)=>({...common,id:'b'+i,kind:'TARIFF',component_code,time_band,measure,amount_text:'10',treatment:'GROSS',source:prefix+root+' · row'+i,embedded_tax_codes:i===3?['PIS','COFINS']:codes}));
 rows.push(...codes.map(code=>({...common,id:code,kind:'TAX',component_code:code,measure:'PERCENT',time_band:'ALL',treatment:'INCLUDED',amount_text:null,source:'OCR fatura'+root,tax_basis:{version:1,items:[0,1].map(i=>({parameterId:'b'+i,revision:2,operation:'INCLUDE'}))}})));
 const a:any={source,sourceReady:true,unit:{id:'unit'},period,ids:['b0','b1'],taxIds:codes,preview:{token:'a',month:'2026-08',candidates:[0,1].map(i=>({band:specs[i][1],rateMwh:'10',source:'row'+i}))}};
 const b:any={source,ready:true,candidates:['USED','UNUSED'].map((classification,i)=>({classification,rate:'10',source:'row'+(i+2),taxCodes:i?['PIS','COFINS']:codes})),preview:{token:'b',month:'2026-08',state:'INTEGRATED',parameterIds:['b2','b3']}};
 (extractCpflPaulistaLayout as jest.Mock).mockReturnValue({layoutId:'neoenergia-elektro-verde',operations:[{source:'row4'}]});(combinedTaxLayout as jest.Mock).mockReturnValue(true);(operationTaxCodes as jest.Mock).mockReturnValue(codes);(reactiveParameterCandidates as jest.Mock).mockReturnValue([{ready:true,source:'row4',band:'OFF_PEAK',rateMwh:'10'}]);
 const run=(write=true)=>elektroTaxContext('doc','org',a,b,rows,['b4'],write);return {a,b,rows,run};
}
describe('Elektro tax bases',()=>{
 it('includes only actual posts, no CDE or fabricated tax rates',()=>{const x=setup(),p=x.run();expect(p.preview.evidenceReady).toBe(true);expect(p.preview.declarations[0]).toMatchObject({state:'READY',included:4,excluded:1,canCreate:true});expect(p.preview.declarations[1]).toMatchObject({included:5,excluded:0});expect(p.declarations[0].items[3].operation).toBe('EXCLUDE');expect(x.run(false).declarations.every(d=>!d.canCreate)).toBe(true);});
 it.each(['organization_id','customer_id','consumer_unit_id','amount_text','source','status','measure','time_band','treatment','start_date'])('rejects incompatible base %s',key=>{const x=setup();x.rows[4][key]='wrong';expect(x.run().preview.evidenceReady).toBe(false);});
 it('rejects missing reactive integration, additional tariff, stale reviews and job',()=>{for(const k of ['missing','extra','review','job']){const x=setup();if(k==='missing')x.rows.splice(4,1);if(k==='extra')x.rows.push({...x.rows[0],id:'extra'});if(k==='review')x.b.ready=false;if(k==='job')x.b.source={...x.b.source,jobId:'other'};expect(x.run().preview.evidenceReady).toBe(false);}});
 it('preserves manual declarations and detects conflicts',()=>{const x=setup();x.rows[5].tax_basis.items[0].operation='EXCLUDE';x.rows.push({...x.rows[6],id:'extra'});expect(x.run().declarations[0].state).toBe('DECLARATION_REQUIRED');expect(x.run().declarations[1].state).toBe('CONFLICT');});
 it('recognizes its replacement after atomic approval and rejects tampering',()=>{const x=setup(),d=x.run().declarations[0],old=x.rows[5];x.rows.push({...old,id:d.nextId,supersedes_parameter_id:old.id,source:old.source+' · versão ampliada do parâmetro '+old.id,tax_basis:{version:1,items:d.items}});old.status='RETIRED';expect(x.run().declarations[0].state).toBe('CREATED');x.rows.at(-1).tax_basis.items[3].operation='INCLUDE';expect(x.run().declarations[0].state).toBe('REVIEW_REQUIRED');});
});

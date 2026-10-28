import {automaticPlanning,cceePlanningObservation,invoicePlanningHistory} from './automatic-planning';
import {extractCpflPaulistaLayout} from '../ocr/cpfl-paulista-layout';
jest.mock('../ocr/cpfl-paulista-layout',()=>({extractCpflPaulistaLayout:jest.fn()}));
const scope={organizationId:'org',customerId:'customer',unitId:'unit'},at='2026-10-28T12:00:00Z';
const field=()=>({text:'100',confidence:null,pages:[3],spans:[{offset:1,length:3}],issues:['MISSING_CONFIDENCE'],transcription:{state:'VERIFIED_WORDS',confidence:0.99,wordCount:1}});
function history(){return Array.from({length:13},(_,i)=>{const d=new Date(Date.UTC(2025,8+i,1)),reference=d.toISOString().slice(0,7),days=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();return ['PEAK','OFF_PEAK'].map(period=>({reference,metric:'CONSUMPTION',period,unit:'kWh',decimal:period==='PEAK'?'1000':'29000',days,evidence:[field()],issues:['HISTORY_FIELD_REVIEW_REQUIRED']}));}).flat();}
const invoice=()=>({documentId:'invoice',fileHash:'a'.repeat(64),publicationId:'published',publicationHash:'b'.repeat(64),month:'2026-09',publishedAt:at,raw:{}});
const publication=(month='2026-09',value='31000')=>({publicationId:'pub-'+month,sourceHash:'c'.repeat(64),publishedAt:at,...scope,month,fields:[{key:'consumptionTotal',value},{key:'consumptionPeak',value:'1000'},{key:'consumptionOffPeak',value:String(Number(value)-1000)}],tariffLines:[]});
function ccee(){const month='2026-09',rows=Array.from({length:720},(_,i)=>({hourLabel:month+'-'+String(Math.floor(i/24)+1).padStart(2,'0')+'T'+String(i%24).padStart(2,'0')+':00:00-03:00',quantityKwh:'50',unit:'kWh',unitEvidence:{kind:'PROVIDER_FIELD'},status:'HCC'}));return {id:'job',month,finishedAt:at,record:{schemaVersion:'ccee-record/1',kind:'CONSUMPTION',binding:scope,evidence:{month,finality:'FINAL',sourceHash:'d'.repeat(64)},lines:[{code:'CONSUMPTION_TOTAL',quantityKwh:'36000',includesLosses:false}]},data:{rows,totalKwh:'36000',expectedHours:720,timeSemantics:'CCEE_HOUR_LABEL_V2'}};}
beforeEach(()=>{(extractCpflPaulistaLayout as jest.Mock).mockReturnValue({measurements:{history:history()}});});
it('creates a current projection with invoice history and no published forecast seed, retaining OCR metadata',()=>{
 const h=history(),before=JSON.stringify(h);(extractCpflPaulistaLayout as jest.Mock).mockReturnValue({measurements:{history:h}});
 const plan=automaticPlanning(scope,{...scope,invoice:invoice(),ccee:[]},[publication()],at);
 expect(plan.state).toBe('AVAILABLE');if(plan.state!=='AVAILABLE')throw Error();expect(plan.current.actual).toHaveLength(13);expect(plan.current.actual.at(-1).consumptionKwh).toBe('31000.000000');expect(plan.current.future.map((r:any)=>r.month)).toEqual(['2026-10','2026-11','2026-12']);expect(JSON.stringify(h)).toBe(before);expect(plan.current.contractingScenario.state).toBe('AVAILABLE');
});
it('prioritizes a complete CCEE month and falls back per month without double counting',()=>{
 const plan=automaticPlanning(scope,{...scope,invoice:invoice(),ccee:[ccee()]},[publication()],at);
 if(plan.state!=='AVAILABLE')throw Error();expect(plan.current.actual.at(-1).consumptionKwh).toBe('36000.000000');expect(plan.origins.at(-1).kind).toBe('CCEE_FINAL');expect(plan.current.actual).toHaveLength(13);
});
it.each(['partial','duplicate','wrongTotal','unknownUnit','scope','losses','provisional','offset'])('rejects %s CCEE and uses published consumption',kind=>{
 const c=ccee();if(kind==='partial')c.data.rows.pop();if(kind==='duplicate')c.data.rows[1]=c.data.rows[0];if(kind==='wrongTotal')c.data.totalKwh='1';if(kind==='unknownUnit')c.data.rows[0].unit='unknown';if(kind==='scope')c.record.binding={...scope,unitId:'foreign'};if(kind==='losses')c.record.lines[0].includesLosses=true;if(kind==='provisional')c.record.evidence.finality='PROVISIONAL';if(kind==='offset')c.data.rows[0].hourLabel=c.data.rows[0].hourLabel.replace('-03:00','Z');
 expect(cceePlanningObservation(scope,c)).toBeNull();const plan=automaticPlanning(scope,{...scope,invoice:invoice(),ccee:[c]},[publication()],at);if(plan.state!=='AVAILABLE')throw Error();expect(plan.current.actual.at(-1).consumptionKwh).toBe('31000.000000');
});
it('keeps ambiguous and low-confidence history pending instead of treating word confidence as approval',()=>{
 const h=history();h[0].evidence[0].transcription.confidence=0.8;h[2].issues.push('HISTORY_DUPLICATE_CANDIDATES');(extractCpflPaulistaLayout as jest.Mock).mockReturnValue({measurements:{history:h}});
 const r=invoicePlanningHistory(scope,invoice());expect(r.rows).toHaveLength(11);expect(r.pending).toHaveLength(2);
});
it('does not manufacture billing days or use demand as a consumption requirement',()=>{
 const h=history();h[0].days=0;(extractCpflPaulistaLayout as jest.Mock).mockReturnValue({measurements:{history:h}});expect(invoicePlanningHistory(scope,invoice()).rows).toHaveLength(12);
});
it('updates the fingerprint and projection when a new publication replaces the prior amount',()=>{
 const source={...scope,invoice:invoice(),ccee:[]},a=automaticPlanning(scope,source,[publication()],at),b=automaticPlanning(scope,source,[publication('2026-09','32000')],at),c=automaticPlanning(scope,source,[publication()],'2026-10-28T13:00:00Z');
 if(a.state!=='AVAILABLE'||b.state!=='AVAILABLE'||c.state!=='AVAILABLE')throw Error();expect(a.sourceFingerprint).not.toBe(b.sourceFingerprint);expect(a.current.futureKwh).not.toBe(b.current.futureKwh);expect(a.sourceFingerprint).toBe(c.sourceFingerprint);
});
it('rejects a foreign source bundle',()=>expect(()=>automaticPlanning(scope,{...scope,customerId:'foreign'},[],at)).toThrow('SCOPE'));

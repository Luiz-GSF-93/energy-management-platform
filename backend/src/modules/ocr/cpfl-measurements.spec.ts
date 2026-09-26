import {extractCpflMeasurements as extract,cpflReference} from './cpfl-measurements';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
const c=(rowIndex:number,columnIndex:number,content:string,extra:any={})=>({rowIndex,columnIndex,content,boundingRegions:[{pageNumber:3}],...extra});
function history(value='JUN 26\n120,00'){return {tables:[{cells:[c(0,0,''),c(0,1,'Consumo Ponta - [kWh]'),c(0,2,'Nº DIAS FAT'),c(1,0,'Consumo',{rowSpan:2}),c(1,1,value),c(1,2,'30')]}]};}
function meter(label='Demanda Ativa - kW'){return {tables:[{cells:['Medidor','Grandezas','Postos horários','Leitura anterior','Leitura atual','Const. Medidor','Consumo kWh'].map((s,i)=>c(0,i,s)).concat(['123',label,'Fora Ponta','000602','000579','0,35000','203'].map((s,i)=>c(1,i,s)))}]};}
describe('CPFL measurement history projection',()=>{
 it('anchors explicit billing reference',()=>{expect(cpflReference('AGO/2026')).toBe('2026-08');expect(cpflReference('AGO/26')).toBeNull();});
 it('separates chart axis labels, retaining original evidence',()=>{const r=extract(history(),'2026-08').history[0];expect(r).toMatchObject({reference:'2026-06',decimal:'120.00',days:30,unit:'kWh',period:'PEAK'});expect(r.evidence[0].text).toBe('Consumo');expect(r.evidence[1].confidence).toBeNull();expect(r.issues).not.toContain('HISTORY_VALUE_AMBIGUOUS');});
 it('does not discard unknown words as chart labels',()=>{const raw=history();raw.tables[0].cells[3].content='Ajuste';expect(extract(raw,'2026-08').history[0].decimal).toBeNull();});
 it('requires an anchor for two digit years',()=>expect(extract(history(),null).history[0].reference).toBeNull());
 it('accepts explicit years without guessing century',()=>expect(extract(history('JUN 2026 120,00'),null).history[0].reference).toBe('2026-06'));
 it.each(['SET 26 120,00','JAN 23 120,00'])('rejects future or out of window reference %s',v=>expect(extract(history(v),'2026-08').history[0].reference).toBeNull());
 it('crosses calendar year correctly',()=>expect(extract(history('DEZ 25 120,00'),'2026-01').history[0].reference).toBe('2025-12'));
 it('rejects multiple months and multiple quantities',()=>{expect(extract(history('JUN 26 JUL 26 12,00'),'2026-08').history[0].decimal).toBeNull();expect(extract(history('JUN 26 12,00 13,00'),'2026-08').history[0].decimal).toBeNull();});
 it('flags negative history',()=>expect(extract(history('JUN 26 -12,00'),'2026-08').history[0].issues).toContain('HISTORY_NEGATIVE_VALUE'));
 it('does not choose a duplicate',()=>{const raw=history();raw.tables.push(raw.tables[0]);const r=extract(raw,'2026-08');expect(r.history).toHaveLength(2);expect(r.history.every(x=>x.issues.includes('HISTORY_DUPLICATE_CANDIDATES'))).toBe(true);});
 it('rejects merged data crossing series boundary',()=>{const raw=history();raw.tables[0].cells[4].columnSpan=2;expect(extract(raw,'2026-08').history[0].decimal).toBeNull();});
 it('flags invalid billing days',()=>{const raw=history();raw.tables[0].cells[5].content='99';expect(extract(raw,'2026-08').history[0].days).toBeNull();});
 it('uses quantity label for demand unit despite shared kWh header',()=>{const r=extract(meter(),null);expect(r.canImport).toBe(false);expect(r.meterReadings[0]).toMatchObject({unit:'kW',kind:'ACTIVE_DEMAND',period:'OFF_PEAK'});expect(r.meterReadings[0].fields.reading.decimal).toBe('203');expect(r.meterReadings[0].fields.previous.text).toBe('000602');});
 it('does not guess malformed reactive units',()=>expect(extract(meter('Energia Reativa - Kva'),null).meterReadings[0].unit).toBeNull());
 it('fails closed for ambiguous meter header',()=>{const raw=meter();raw.tables[0].cells[0].columnSpan=2;expect(extract(raw,null).meterReadings).toHaveLength(0);});
 it('gates measurements by distributor identification',()=>expect(extractCpflPaulistaLayout(history()).measurements).toBeNull());
 it('handles empty input',()=>expect(extract(null,null).history).toEqual([]));
});

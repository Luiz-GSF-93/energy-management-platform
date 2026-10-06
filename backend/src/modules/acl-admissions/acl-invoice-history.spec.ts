import {aclHistoryDraft,validAclHistory,aclInvoiceReferenceMonth} from './acl-invoice-history';
import {extractCpflMeasurements} from '../ocr/cpfl-measurements';
const rows=()=>Array.from({length:12},(_,i)=>({month:new Date(Date.UTC(2025,8+i,1)).toISOString().slice(0,7),peakKwh:'100.00',offPeakKwh:'1000.00',demandKw:'250.00',days:30,page:2,source:'Tabela de histórico da página 2'}));
describe('ACL invoice history evidence',()=>{
 it('accepts twelve ordered measured months from one identified invoice',()=>expect(validAclHistory({sourceDocumentId:'doc',rows:rows()},['doc'])).toBe(true));
 it.each(['gap','duplicate','negative','missing','foreign','cost','numeric','days','page'])('rejects %s instead of inventing measurements',kind=>{const r:any=rows(),h:any={sourceDocumentId:'doc',rows:r};if(kind==='gap')r[5].month='2026-03';if(kind==='duplicate')r[5].month=r[4].month;if(kind==='negative')r[0].demandKw='-1';if(kind==='missing')r[0].peakKwh='';if(kind==='foreign')h.sourceDocumentId='other';if(kind==='cost')r[0].cost='5000';if(kind==='numeric')r[0].demandKw=250;if(kind==='days')r[0].days=0;if(kind==='page')r[0].page=0;expect(validAclHistory(h,['doc'])).toBe(false);});
 it('keeps missing OCR months pending and does not return monthly costs',()=>{const r=aclHistoryDraft([],'2026-08');expect(r.rows.map(x=>x.month)).toEqual(rows().map(x=>x.month));expect(r.rows.every(x=>x.peakKwh===''&&x.demandKw==='')).toBe(true);expect(r.reviewRequired).toBe(true);expect(r.costHistoryAvailable).toBe(false);});
 it('extracts unqualified demand as total, without inferring off-peak',()=>{const raw={tables:[{cells:[{rowIndex:0,columnIndex:0,content:'Demanda - [kW]'},{rowIndex:0,columnIndex:1,content:'Nº DIAS FAT'},{rowIndex:1,columnIndex:0,content:'AGO 26 271,00'},{rowIndex:1,columnIndex:1,content:'31'}]}]};const h=extractCpflMeasurements(raw,'2026-08').history;expect(h[0]).toMatchObject({metric:'DEMAND',period:'TOTAL',decimal:'271.00',reference:'2026-08'});});
});

describe('document registry invoice month formats',()=>{
 it.each(['2026-08-01','2026-08-01T00:00:00','2026-08-01T00:00:00Z','2026-08-01T00:00:00+00:00','2026-08-01T00:00:00.000Z'])('accepts month-start %s',value=>expect(aclInvoiceReferenceMonth(value)).toBe('2026-08'));
 it.each([null,undefined,202608,'2026-08','2026-13-01','2026-08-02T00:00:00','2026-08-01T12:00:00','2026-08-01T00:00:00-03:00','2026-08-01T00:00:00garbage'])('rejects invalid reference %s',value=>expect(aclInvoiceReferenceMonth(value)).toBeNull());
});

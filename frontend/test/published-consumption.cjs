const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript');
require.extensions['.ts']=(m,p)=>m._compile(ts.transpileModule(fs.readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,p);
const {publishedConsumptionRows}=require('../app/backoffice/reports/published-consumption.ts');
// Fixture data is confined to regression tests.
const invoice={groupId:'publication',month:'2026-01',version:2,payloadHash:'a'.repeat(64),consumptionKwh:'500.00',reservationCount:0};
const report={id:'report',body:{header:{organizationId:'org',customerId:'customer',unitId:'unit'},period:{from:'2026-01',to:'2026-01'},invoices:[invoice]}};
const row={...invoice,unitId:'unit',measurements:{version:4,revision:3,validatedAt:'2026-02-01T12:00:00Z',source:'Fatura revisada',measurements:{consumptionTotal:'500.00',consumptionPeak:'100.00',consumptionOffPeak:'400.00'}}};
const response=rows=>({organizationId:'org',primary:{invoices:rows}});let count=0;const check=(actual,expected)=>{assert.equal(actual,expected);count++;};
const result=publishedConsumptionRows(report,response([row]))[0];check(result.peakKwh,'100.00');check(result.offPeakKwh,'400.00');check(result.measurementVersion,4);check(result.measurementSource,'Fatura revisada');
for(const patch of [{unitId:'foreign'},{month:'2026-02'},{groupId:'other'},{version:3},{payloadHash:'b'.repeat(64)}])check(publishedConsumptionRows(report,response([{...row,...patch}]))[0].peakKwh,null);
check(publishedConsumptionRows(report,response([row,row]))[0].peakKwh,null);check(publishedConsumptionRows(report,response([]))[0].peakKwh,null);
for(const patch of [{validatedAt:''},{source:''},{version:null},{revision:null},{measurements:{...row.measurements.measurements,consumptionTotal:'600.00'}}])check(publishedConsumptionRows(report,response([{...row,measurements:{...row.measurements,...patch}}]))[0].peakKwh,null);
const absent=publishedConsumptionRows(report,response([{...row,measurements:{...row.measurements,measurements:{consumptionTotal:'500.00',consumptionPeak:null,consumptionOffPeak:'0'}}}]))[0];check(absent.peakKwh,null);check(absent.offPeakKwh,'0');
assert.throws(()=>publishedConsumptionRows(report,{...response([row]),organizationId:'other'}),/fora da organização/);count++;
check(invoice.consumptionKwh,'500.00');check(row.measurements.measurements.consumptionPeak,'100.00');
console.log(`${count} publication-bound consumption checks passed`);

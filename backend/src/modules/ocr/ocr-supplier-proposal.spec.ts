import {ocrSupplierProposal} from './ocr-supplier-proposal';
describe('Current draft supplier proposal',()=>{
 const s={formulaVersion:'spot-supplier-1.0',contract:{id:'c'},rule:{id:'r'},contractedMwh:'77.542000000000',pricePerMwh:'151.820046000000',taxTreatment:'NET',regularAmount:null,volumeDifferenceMwh:null};
 const m={consumptionTotal:'77488.9800',consumptionPeak:'11807.0400',consumptionOffPeak:'65681.9400'};
 it('keeps a source-based proposal after a new draft blocks the financial result, without validating or inventing NF',()=>{const before=JSON.stringify({s,m});expect(ocrSupplierProposal(s,m,{},'2026-08',true)).toEqual({amount:'11772.43',difference:'-0.053020000000'});expect(JSON.stringify({s,m})).toBe(before);});
 it('does not propose from unconfirmed sources, invalid quantities, incomplete contract conditions or another purchase mode',()=>{for(const [supplier,measurements,ready] of [[s,m,false],[{...s,rule:null},m,true],[{...s,formulaVersion:'contract-supplier-1.0'},m,true],[s,{...m,consumptionPeak:'0'},true],[s,{...m,consumptionTotal:null},true],[{...s,pricePerMwh:null},m,true]] as any[])expect(ocrSupplierProposal(supplier,measurements,{},'2026-08',ready)).toEqual({amount:null,difference:null});});
});

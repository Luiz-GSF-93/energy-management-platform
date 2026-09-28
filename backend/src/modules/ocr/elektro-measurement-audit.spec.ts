import {elektroMeasurementAudit} from './elektro-measurement-audit';
function fixture(values:string[],description='TUSD ENERGIA PONTA TUSD'){
 const raw:any={content:'Elektro Redes S.A. HORÁRIA VERDE\n',pages:[{pageNumber:1},{pageNumber:2}],tables:[]};
 const cell=(content:string,rowIndex:number,columnIndex:number,p:number)=>{const offset=raw.content.length;raw.content+=content+'\n';return {content,rowIndex,columnIndex,spans:content?[{offset,length:content.length}]:[],boundingRegions:[{pageNumber:p}]};};
 const table=(rows:string[][],p:number)=>({boundingRegions:[{pageNumber:p}],cells:rows.flatMap((r,i)=>r.map((v,j)=>cell(v,i,j,p)))});
 raw.tables.push(table([['ITENS DE FATURA','UNID.','QUANT.','PREÇOUNIT. COM TRIB. (RS)','VALOR (RS)','PIS/COFINS (RS)','BASE CALC. ICMS (RS)','ALIQUOTA ICMS (%)','ICMS (RS)','TARIFA UNIT. (RS)'],[description,'kWh','20','2,00','40,00','1,00','40,00','18%','7,20','1,00'],[description,'kWh','10','1,00','10,00','0,50','0,00','0%','0,00','1,00']],1));
 raw.tables.push(table([['DESCRIÇÃO','','LEITURA','CONSTANTE','AJUSTE','CONSUMO/DEMANDA'],['','DE','ATÉ','','',''],[description,...values]],2));return raw;
}
describe('Elektro measurement audit',()=>{
 it('does not add the repeated demonstrative to the financial total or collapse distinct same-name monetary rows',()=>{const r=elektroMeasurementAudit(fixture(['10','20','2','','20']))!;expect(r.operationTotalCents).toBe('5000');expect(r.charges).toHaveLength(2);expect(r.entries[0].state).toBe('MATCH');});
 it('records missing source fields and preserves quantity and monetary source',()=>{const r=elektroMeasurementAudit(fixture(['','','','','20']))!;expect(r.entries[0].missing).toEqual(['leitura anterior','leitura atual','constante do medidor']);expect(r.entries[0].state).toBe('NOT_VERIFIABLE');expect(r.entries[0].message).toContain('Valor faturado preservado');expect(r.entries[0].pages).toEqual([2]);expect(r.operationTotalCents).toBe('5000');});
 it('does not interpret explicit zero readings as absent or validate a divergent consumption',()=>{const r=elektroMeasurementAudit(fixture(['0','0','2','','20']))!;expect(r.entries[0].missing).toEqual([]);expect(r.entries[0].state).toBe('DIVERGENT');});
 it('does not guess ambiguous decimal constants',()=>{expect(elektroMeasurementAudit(fixture(['0','20','.72','','20']))!.entries[0].state).toBe('NOT_VERIFIABLE');});
 it('does not infer demand from difference of readings',()=>{expect(elektroMeasurementAudit(fixture(['10','20','2','','20'],'DEMANDA DE DISTRIBUICAO TUSD'))!.entries[0].state).toBe('NOT_VERIFIABLE');});
 it('does not apply a printed adjustment without its rule',()=>{expect(elektroMeasurementAudit(fixture(['10','20','2','3','23']))!.entries[0].state).toBe('NOT_VERIFIABLE');});
 it('keeps printed zero quantity distinct from a missing quantity',()=>{expect(elektroMeasurementAudit(fixture(['0','0','2','','0']))!.entries[0].state).toBe('MATCH');});
 it('does not apply Elektro rules to other distributors',()=>{const raw=fixture(['10','20','2','','20']);raw.content=raw.content.replace('Elektro Redes S.A.','Outra distribuidora');expect(elektroMeasurementAudit(raw)).toBeNull();});
 it('does not compare an unverified source cell',()=>{const raw=fixture(['10','20','2','','20']);raw.tables[1].cells.find((c:any)=>c.rowIndex===2&&c.columnIndex===2).spans=[];expect(elektroMeasurementAudit(raw)!.entries[0].state).toBe('NOT_VERIFIABLE');});
});

describe("masked CNPJ",()=>{it("compares only the visible suffix and does not approve import",()=>{const raw=fixture(["0","0","2","","0"]);const content="CNPJ - ******** 001458";const offset=raw.content.length;raw.content+=content;raw.keyValuePairs=[{key:{content,spans:[{offset,length:content.length}],boundingRegions:[{pageNumber:1}]},value:{content:"123456789"}}];expect(elektroMeasurementAudit(raw,"11222333001458")!.partialTaxId.state).toBe("PARTIAL_MATCH");expect(elektroMeasurementAudit(raw,"11222333009999")!.partialTaxId.state).toBe("MISMATCH");expect(elektroMeasurementAudit(raw,"11222333001458")!.canImport).toBe(false);});});

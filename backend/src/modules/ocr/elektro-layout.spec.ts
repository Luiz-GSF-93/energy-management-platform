import {invoiceFinancialAdjustments} from './invoice-financial-adjustments';
import {combinedTaxLayout} from './reviewed-layout-support';
import {tusdParameterCandidates} from './tusd-parameter-candidates';
import {extractElektroLayout} from './elektro-layout';
import {extractCpflPaulistaLayout} from './cpfl-paulista-layout';
function fixture(){const raw:any={content:'',documents:[{fields:{}}],pages:[{pageNumber:1,lines:[]},{pageNumber:2,lines:[]}],tables:[],keyValuePairs:[]};
 const field=(content:string,page=1)=>{const offset=raw.content.length;raw.content+=content+'\n';return {content,spans:[{offset,length:content.length}],boundingRegions:[{pageNumber:page}],confidence:.99};};
 raw.pages[0].lines.push(field('Elektro Redes S.A.'));const pair=(key:string,value:string,page=1)=>raw.keyValuePairs.push({key:field(key,page),value:field(value,page),confidence:.99});
 pair('TIPO DE FORNECIMENTO:','HORÁRIA VERDE / TRIFASICO');pair('NOME DO CLIENTE:','CLIENTE DE TESTE');pair('NÚMERO DA UNIDADE CONSUMIDORA','123');pair('REF: MÊS / ANO','Agosto/2026');pair('TOTAL A PAGAR','R$ 28,00');pair('CNPJ - ******** 000191','998877');
 const matrix=[['ITENS DE FATURA','UNID.','QUANT.','PREÇOUNIT. COM TRIB. (RS)','VALOR (RS)','PIS/COFINS (RS)','BASE CALC. ICMS (RS)','ALIQUOTA ICMS (%)','ICMS (RS)','TARIFA UNIT. (RS)'],['TUSD ENERGIA PONTA TUSD','kWh','10','1,000000','10,00','1,00','10,00','18%','1,80','0,7'],['TUSD ENERGIA FORA DE PONTA TU','kWh','20','1,000000','20,00','2,00','20,00','18%','3,60','0,7'],['SUBSIDIO TARIFARIO LIQUIDO','','','','-2,00','','','0%','','']];
 const table=(data:string[][],page=1)=>({boundingRegions:[{pageNumber:page}],cells:data.flatMap((row,ri)=>row.map((v,ci)=>({...field(v,page),rowIndex:ri,columnIndex:ci})))});
 raw.tables.push(table(matrix),table([['DESCRIÇÃO','','LEITURA','CONSTANTE','AJUSTE','CONSUMO/DEMANDA'],['','DE','ATÉ','','',''],['TUSD ENERGIA PONTA TUSD','0','0','.72','','10']],2),table([['TRIBUT O','BASE','ALIQUOTA','VALOR (RS)'],['ICMS','30,00','18%','5,40'],['PIS','30,00','1%','1,00'],['COFINS','30,00','2%','2,00']]));
 return {raw,field,pair,table,matrix};}
 describe('Elektro structured layout',()=>{
 it('dispatches the layout and reconciles charges and credits without the repeated demonstration',()=>{const {raw}=fixture(),r=extractCpflPaulistaLayout(raw);expect(r.layoutId).toBe('neoenergia-elektro-verde');expect(r.operations).toHaveLength(3);expect(r.reconciliation.state).toBe('MATCH');expect(r.preparation?.values.map(v=>v.decimal)).toEqual(['10','20','30']);expect(r.operations[2].role).toBe('CREDIT');expect(r.canImport).toBe(false);});
 it('keeps combined PIS/Cofins and reconciles their fiscal summary without splitting lines',()=>{const {raw}=fixture(),r=extractElektroLayout(raw)!;expect(r.operations[0].fields.pisCofinsAmount.decimal).toBe('1.00');expect(r.operations[0].fields.pisAmount).toBeUndefined();expect(r.taxReconciliation.checks.map(c=>c.state)).toEqual(['MATCH_EXTRACTED','MATCH_EXTRACTED']);});
 it('preserves the masked key, never IE as customer CNPJ',()=>{const {raw}=fixture(),r=extractElektroLayout(raw)!;expect(r.fields.find(f=>f.name==='customerTaxId')?.value.text).toBe('CNPJ - ******** 000191');});
 it('does not accept unsupported issuers',()=>{const {raw}=fixture();raw.pages[0].lines[0].content='Outra distribuidora';expect(extractElektroLayout(raw)).toBeNull();});
 it('blocks conflicting financial tables and does not deduplicate same-name monetary lines',()=>{const {raw,table,matrix}=fixture();raw.tables.push(table(matrix));const r=extractElektroLayout(raw)!;expect(r.operations).toHaveLength(6);expect(r.reconciliation.state).toBe('NOT_VERIFIABLE');expect(r.preparation).toBeNull();});
 it('does not reconcile an unverified amount',()=>{const {raw}=fixture();raw.tables[0].cells.find((c:any)=>c.rowIndex===1&&c.columnIndex===4).spans=[];expect(extractElektroLayout(raw)!.reconciliation.state).toBe('NOT_VERIFIABLE');});
 it('does not silently choose conflicting totals',()=>{const {raw,pair}=fixture();pair('TOTAL A PAGAR','R$ 27,00');expect(extractElektroLayout(raw)!.reconciliation.state).toBe('NOT_VERIFIABLE');});
 it('keeps measured demand missing instead of converting billed demand to measured',()=>{const {raw}=fixture();expect(extractElektroLayout(raw)!.preparation?.demand.measured.every(v=>v.decimal===null)).toBe(true);});
 });

describe('Elektro integration evidence',()=>{
 it('integrates gross TUSD with combined taxes',()=>{const l=extractElektroLayout(fixture().raw)!;expect(combinedTaxLayout(l)).toBe(true);expect(tusdParameterCandidates(l.operations,true).every(c=>c.ready)).toBe(true);expect(tusdParameterCandidates(l.operations).every(c=>c.ready)).toBe(false);});
 it('reconciles adjustments without creating absent CIP',()=>{const l=extractElektroLayout(fixture().raw)!;const a=invoiceFinancialAdjustments(l);expect(a.state).toBe('RECONCILED');expect(a.cip).toBeNull();expect(a.items).toHaveLength(1);expect(a.items[0]).toMatchObject({effect:'CREDIT',amount:'2.00'});expect(a.total).toBe('28.00');});
 it('blocks costs when total does not reconcile',()=>{const l=extractElektroLayout(fixture().raw)!;l.reconciliation.state='NOT_VERIFIABLE';expect(invoiceFinancialAdjustments(l).state).toBe('REVIEW_REQUIRED');});
});

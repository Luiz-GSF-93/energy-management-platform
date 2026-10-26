import {supplierDocumentKind,supplierInvoiceProposal} from './supplier-invoice-proposal';
const source={documentId:'doc',fileHash:'a'.repeat(64)};
const text=`DANFE DESTINATÁRIO / REMETENTE
Empresa sintética 11.222.333/0001-81 02/06/2026
FATURA / DUPLICATAS
Número: 100, Valor original: 300,00, Valor do Desconto: 0,00, Valor Líquido: 300,00
DADOS DO PRODUTO / SERVIÇO
ENERGIA ELETRICA (Incentivada) fornecida no mês de maio/2026
27160000 041 6252 MWh 1,5000 200,0000 300,00 0,00
DADOS ADICIONAIS`;
const run=(t=text,month='2026-05',tax='11222333000181')=>supplierInvoiceProposal(t,month,tax,source);
describe('Supplier NF proposal',()=>{
 const electra=`DANFE CNPJ PROTOCOLO DE AUTORIZACAO DE USO
 141260044321870 - 03/02/2026 Empresa sintetica 11.222.333/0001-81
 DESTINATARIO REMETENTE CALCULO DO IMPOSTO
 Fatura: 001 Vencimento: 09/02/2026 Valor: 300,00
 FATURA / DUPLICATAS
 DADOS DO PRODUTO / SERVICO
 ENER00002 2716.00.00 041 6252 MWH 1,5000 300,00 0,00 0,00 0,00 0,00 0,00 200,0000 ENERGIA ELETRICA
 DADOS ADICIONAIS FATURAMENTO REF 01/2026
 A responsabilidade pelo recolhimento do ICMS fica atribuida ao destinario no estado de SP`;
 it('reads invoice values and destination ICMS without requiring an index memory or using the issue month',()=>expect(run(electra,'2026-01')).toMatchObject({month:'2026-01',quantityMwh:'1.5000',pricePerMwh:'200.0000',amount:'300.00',taxTreatment:'NET_DESTINATION_ICMS',taxEvidence:{kind:'DESTINATION_ICMS'},financialApproval:false}));
 it.each(['recipient','month','price','zero-is-not-exemption','duplicate','fatura'])('rejects an unsafe destination-ICMS invoice: %s',kind=>{let t=electra;if(kind==='recipient')t=t.replace('11.222.333/0001-81','22.333.444/0001-82');if(kind==='month')t=t.replace('01/2026','02/2026');if(kind==='price')t=t.replace('200,0000','201,0000');if(kind==='zero-is-not-exemption')t=t.replace('recolhimento do ICMS','outro tributo');if(kind==='duplicate')t=t.replace('DADOS ADICIONAIS','MWH 1,5000 300,00 0,00 0,00 0,00 0,00 0,00 200,0000 ENERGIA ELETRICA\nDADOS ADICIONAIS');if(kind==='fatura')t=t.replace('Valor: 300,00','Valor: 301,00');expect(run(t,'2026-01')).toBeNull();});
 const alternate=`DANFE CNPJ DESTINATARIO/REMETENTE
 Empresa sintetica 11.222.333/0001-81
 FATURA/DUPLICATA VENCIMENTO VALOR FATURA/DUPLICATA VENCIMENTO VALOR
 100 09.09.2026 300,00 0,00 0,00
 VALOR TOTAL DA NF
 0,00 0,00 0,00 0,00 0,00 300,00
 DADOS DOS PRODUTOS/SERVICOS
 80005851 CONSUMO CONTRATADO 07.001.00 2716.00.00 041 6252 MWH 1,5000 200,0000 300,00 0,00 0,00 0,00
 DADOS ADICIONAIS
 PERIODO DE SUPRIMENTO/FORNECIMENTO: 08/2026.
 Nao incidencia de ICMS conforme documento do fornecedor.`;
 it('reads alternative DANFE headings and the supply competence without inferring tax exemption',()=>expect(run(alternate,'2026-08')).toMatchObject({quantityMwh:'1.5000',pricePerMwh:'200.0000',amount:'300.00',taxTreatment:'UNCONFIRMED',taxEvidence:null}));
 it.each(['period','quantity','total','recipient','multiple products','non-energy'])('rejects inconsistent alternative billing: %s',kind=>{let t=alternate;if(kind==='period')t=t.replace('08/2026','09/2026');if(kind==='quantity')t=t.replace('1,5000','1,5001');if(kind==='total')t=t.replace('0,00 300,00','0,00 301,00');if(kind==='recipient')t=t.replace('11.222.333/0001-81','22.333.444/0001-82');if(kind==='multiple products')t=t.replace('DADOS ADICIONAIS','MWH 1,5000 200,0000 300,00 DADOS ADICIONAIS');if(kind==='non-energy')t=t.replace('2716.00.00','9999.00.00');expect(run(t,'2026-08')).toBeNull();});

 const native=`DANFE CNPJ DESTINATARIO/REMETENTE
 Empresa sintetica 11.222.333/0001-81
 FATURA/DUPLICATA VENCIMENTO VALOR
 100 09.09.2026 300,00 0,00 0,00
 CD. PROD. DESCRICAO PRODUTO/SERVICO CEST NCM/SH CST CFOP UN QTDE. VL.UNIT. VL.TOTAL
 80005851 CONSUMO CONTRATADO 07.001.00 2716.00.00 041 6252 MWH 1,5000 200,0000 300,00 0,00 0,00 0,00
 CALCULO DO IMPOSTO
 VALOR TOTAL PRODUTOS
 300,00
 VALOR DO FRETE
 0,00
 VALOR DO SEGURO
 0,00
 DESCONTO
 0,00
 OUTRAS DESPESAS
 0,00
 VALOR DO IPI
 0,00
 VALOR TOTAL DA NF
 300,00
 DADOS DOS PRODUTOS/SERVICOS
 DADOS ADICIONAIS
 PERIODO DE SUPRIMENTO/FORNECIMENTO: 08/2026.`;
 it('reads native PDF ordering with separately labeled totals',()=>expect(run(native,'2026-08')).toMatchObject({quantityMwh:'1.5000',amount:'300.00',taxTreatment:'UNCONFIRMED'}));
 it.each(['missing header','freight','total','duplicate total','period','product'])('rejects inconsistent native cells: %s',kind=>{let t=native;if(kind==='missing header')t=t.replace('CD. PROD.','OTHER');if(kind==='freight')t=t.replace('VALOR DO FRETE\n 0,00','VALOR DO FRETE\n 1,00');if(kind==='total')t=t.replace('VALOR TOTAL DA NF\n 300,00','VALOR TOTAL DA NF\n 301,00');if(kind==='duplicate total')t=t.replace('DADOS DOS PRODUTOS','VALOR TOTAL DA NF\n 300,00\n DADOS DOS PRODUTOS');if(kind==='period')t=t.replace('08/2026','09/2026');if(kind==='product')t=t.replace('2716.00.00','9999.00.00');expect(run(t,'2026-08')).toBeNull();});
 it('reads the explicit destination-ICMS clause with the standard MWh row as well as the fallback layout',()=>{const clause='SC800003 - ICMS a ser lançado e recolhido pelo destinatário da energia nos termos do disposto no artigo 425-D do RICMS-SP/2022';expect(run(text+'\n'+clause)).toMatchObject({taxTreatment:'NET_DESTINATION_ICMS',amount:'300.00'});expect(run(text+'\nNão '+clause.replace('SC800003 - ',''))).toMatchObject({taxTreatment:'UNCONFIRMED'});expect(run(text+'\n'+clause.replace('destinatário','emitente'))).toMatchObject({taxTreatment:'UNCONFIRMED'});});
 it('uses the explicit recipient CNPJ cell when native phone or IE cells join digits, rejecting a second CNPJ',()=>{expect(run(text.replace('02/06/2026','02/06/2026 00582290401119'))).toMatchObject({amount:'300.00'});expect(run(text.replace('02/06/2026','02/06/2026 22.333.444/0001-82'))).toBeNull();});
 it('classifies contract content independently of the uploaded filename',()=>{expect(supplierDocumentKind('MINUTA DE CONTRATO COMPRADORA VENDEDORA CLAUSULA 1')).toBe('CONTRACT');expect(supplierDocumentKind(electra)).toBe('INVOICE');expect(supplierDocumentKind('image only')).toBe('UNKNOWN');});
 it('extracts an integral energy row with exact arithmetic without asserting taxes or payment',()=>expect(run()).toMatchObject({quantityMwh:'1.5000',pricePerMwh:'200.0000',amount:'300.00',taxTreatment:'UNCONFIRMED',reviewRequired:true,financialApproval:false}));
 it.each(['recipient','month','duplicate','total','discount','quantity'])('rejects ambiguous/mismatched %s',kind=>{let t=text;if(kind==='recipient')t=t.replace('11.222.333/0001-81','22.333.444/0001-82');if(kind==='month')t=t.replace('maio/2026','abril/2026');if(kind==='duplicate')t=t.replace('DADOS ADICIONAIS','MWh 1,0000 200,0000 200,00 DADOS ADICIONAIS');if(kind==='total')t=t.replace('Valor Líquido: 300,00','Valor Líquido: 301,00');if(kind==='discount')t=t.replace('Desconto: 0,00','Desconto: 1,00');if(kind==='quantity')t=t.replace('1,5000','1,5001');expect(run(t)).toBeNull();});
 it('does not accept the supplier CNPJ as recipient identity',()=>expect(run('11.222.333/0001-81 '+text.replace('11.222.333/0001-81','22.333.444/0001-82'))).toBeNull());
});

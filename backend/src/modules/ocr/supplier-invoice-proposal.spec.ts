import {supplierInvoiceProposal} from './supplier-invoice-proposal';
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
 it('extracts an integral energy row with exact arithmetic without asserting taxes or payment',()=>expect(run()).toMatchObject({quantityMwh:'1.5000',pricePerMwh:'200.0000',amount:'300.00',taxTreatment:'UNCONFIRMED',reviewRequired:true,financialApproval:false}));
 it.each(['recipient','month','duplicate','total','discount','quantity'])('rejects ambiguous/mismatched %s',kind=>{let t=text;if(kind==='recipient')t=t.replace('11.222.333/0001-81','22.333.444/0001-82');if(kind==='month')t=t.replace('maio/2026','abril/2026');if(kind==='duplicate')t=t.replace('DADOS ADICIONAIS','MWh 1,0000 200,0000 200,00 DADOS ADICIONAIS');if(kind==='total')t=t.replace('Valor Líquido: 300,00','Valor Líquido: 301,00');if(kind==='discount')t=t.replace('Desconto: 0,00','Desconto: 1,00');if(kind==='quantity')t=t.replace('1,5000','1,5001');expect(run(t)).toBeNull();});
 it('does not accept the supplier CNPJ as recipient identity',()=>expect(run('11.222.333/0001-81 '+text.replace('11.222.333/0001-81','22.333.444/0001-82'))).toBeNull());
});

import {CostLedger} from './monthly-cost-ledger';
import {additionalCostSubtotal} from './additional-cost-subtotal';
export type SupplierCostMemory={formulaVersion:'supplier-invoice-1.0';version:CostLedger['version'];status:'AVAILABLE'|'BLOCKED';costs:string|null;credits:string|null;balance:string|null;baseInvoice:string|null;extraPurchases:string|null;entries:{id:string;label:string;category:string;amount:string;effect:string;source:string}[];blockers:string[];warnings:string[]};
const money=(v:bigint)=>{const s=(v<0n?-v:v).toString().padStart(3,'0');return (v<0n?'-':'')+s.slice(0,-2)+'.'+s.slice(-2);};
export function supplierCostMemory(ledger:CostLedger):SupplierCostMemory{
 const subtotal=additionalCostSubtotal(ledger).scenarios.find(s=>s.scenario==='ACL')!;
 const entries=ledger.groups.filter(g=>g.scenario==='ACL').flatMap(g=>g.lines);
 const result:SupplierCostMemory={formulaVersion:'supplier-invoice-1.0',version:ledger.version,status:'BLOCKED',costs:null,credits:null,balance:null,baseInvoice:null,extraPurchases:null,entries:[],blockers:[...subtotal.blockers],warnings:[
  'Custo efetivo informado conforme faturas conferidas e validadas. Não deriva do volume contratual, preço de referência ou consumo medido.',
  'Saldo fornecedor = faturas regulares + compras extras − créditos. Compras extras devem ser lançadas somente quando não estiverem incluídas na fatura regular.',
  'Registre a identificação do documento e a justificativa de rateio por unidade na fonte. A conferência humana deve evitar documentos duplicados; não há conciliação automática nesta etapa.',
  'Tributos excluídos impedem o saldo final. Não calcula diferenças contratuais, penalidades, exposição CCEE ou economia.'
 ]};
 if(!entries.some(e=>e.category==='SUPPLIER_INVOICE'&&e.effect==='COST'))result.blockers.push('Registre e valide a fatura regular do fornecedor. Compra extra isolada não comprova o custo completo do fornecedor.');
 if(entries.some(e=>!['SUPPLIER_INVOICE','SUPPLIER_EXTRA_ENERGY'].includes(e.category)))result.blockers.push('A memória do fornecedor contém outras categorias de custo.');
 if(subtotal.status!=='AVAILABLE'||result.blockers.length)return result;
 let base=0n,extra=0n;
 for(const e of entries){const n=BigInt(e.signedAmount.replace('.',''));if(e.category==='SUPPLIER_INVOICE')base+=n;else extra+=n;}
 Object.assign(result,{status:'AVAILABLE',costs:subtotal.costs,credits:subtotal.credits,balance:subtotal.balance,baseInvoice:money(base),extraPurchases:money(extra),entries:entries.map(({id,label,category,amount,effect,source})=>({id,label,category,amount,effect,source}))});
 return result;
}

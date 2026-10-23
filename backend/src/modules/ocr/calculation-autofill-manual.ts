import {SupplierSettlement,supplierSettlementInput} from './documented-supplier-settlement';
import {SupplierInvoiceAllocation,supplierInvoiceAllocationInput} from './supplier-invoice-evidence';
export type ManualCommercial={fixedFee?:string;feePercentage?:string;supplierPricePerMwh?:string;supplierSettlement?:SupplierSettlement;supplierInvoiceAllocation?:SupplierInvoiceAllocation};
export function commercialProposal(value:unknown):ManualCommercial{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Valores comerciais inválidos.');
 const v=value as Record<string,unknown>,out:ManualCommercial={};
 if(!Object.keys(v).length||Object.keys(v).some(k=>!['fixedFee','feePercentage','supplierPricePerMwh','supplierSettlement','supplierInvoiceAllocation'].includes(k)))throw Error('Informe somente honorários, fornecedor e cobertura da NF.');
 for(const [key,x] of Object.entries(v)){
  if(key==='supplierInvoiceAllocation'){out.supplierInvoiceAllocation=supplierInvoiceAllocationInput(x);continue;}
  if(key==='supplierSettlement'){out.supplierSettlement=supplierSettlementInput(x);continue;}
  if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,8})(\.\d{1,6})?$/.test(x)||key==='fixedFee'&&(x.split('.')[1]?.length??0)>2||key==='feePercentage'&&(!/^(100(\.0{1,4})?|[0-9]{1,2}(\.\d{1,4})?)$/.test(x)))throw Error('Confira formato, casas decimais e percentual de 0 a 100.');
  (out as any)[key]=x;
 }
 if(out.supplierSettlement&&out.supplierPricePerMwh!==undefined)throw Error('Conciliação documentada usa o preço da nota/memória; remova a substituição genérica do fornecedor.');
 if(out.supplierInvoiceAllocation&&(out.supplierSettlement||out.supplierPricePerMwh!==undefined))throw Error('A cobertura da NF integral não pode concorrer com outra alocação ou preço manual.');
 return out;
}

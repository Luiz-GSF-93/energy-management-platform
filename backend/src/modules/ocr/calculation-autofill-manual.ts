export type ManualCommercial={fixedFee?:string;feePercentage?:string;supplierPricePerMwh?:string};
export function commercialProposal(value:unknown):ManualCommercial{
 if(value===undefined)return {};
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Valores comerciais inválidos.');
 const v=value as Record<string,unknown>,out:ManualCommercial={};
 if(!Object.keys(v).length||Object.keys(v).some(k=>!['fixedFee','feePercentage','supplierPricePerMwh'].includes(k)))throw Error('Informe somente honorários e preço do fornecedor.');
 for(const [key,x] of Object.entries(v)){
  if(typeof x!=='string'||!/^(0|[1-9][0-9]{0,8})(\.\d{1,6})?$/.test(x)||key==='fixedFee'&&(x.split('.')[1]?.length??0)>2||key==='feePercentage'&&(!/^(100(\.0{1,4})?|[0-9]{1,2}(\.\d{1,4})?)$/.test(x)))throw Error('Confira formato, casas decimais e percentual de 0 a 100.');
  out[key as keyof ManualCommercial]=x;
 }
 return out;
}

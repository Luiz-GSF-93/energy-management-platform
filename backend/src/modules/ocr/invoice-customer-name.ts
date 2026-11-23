const norm=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const compact=(value:string)=>norm(value).replace(/[^A-Z0-9]/g,'');
const legalCore=(value:string)=>compact(norm(value).trim().replace(/\s+(?:LTDA\.?|LIMITADA|EIRELI)(?:\s*[- ]?\s*(?:ME|EPP))?\s*$/,''));
/** Names locate the recipient band; CNPJ, UC, address and period remain
 * independent mandatory evidence. Only an exact business-name core can
 * reconcile a changed legal suffix. Never use a prefix or fuzzy similarity. */
export function invoiceCustomerNameMatches(part:string,registered:string|null|undefined){
 const name=compact(registered??''),group=compact(norm(registered??'').replace(/\b(?:MATRIZ|FILIAL)\b.*$/,''));
 if(name.length<8)return false;
 if(compact(part).includes(name)||group.length>=8&&compact(part).includes(group))return true;
 const core=legalCore(registered??'');
 return core.length>=12&&core!==name&&part.split(/[\r\n]+/).some(line=>legalCore(line)===core);
}

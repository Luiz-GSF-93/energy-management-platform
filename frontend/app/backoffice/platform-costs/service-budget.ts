export type BudgetReading={amount_minor:string|number;currency:string;basis:string}|null;
export function serviceBudgetReading(budget:number|null,currency:string|null,cost:BudgetReading){
 const result=(level:string,message:string,percent:string|null=null)=>({level,message,percent});
 if(budget==null||!Number.isSafeInteger(budget)||budget<=0||!currency)return result('UNCONFIGURED','Orçamento não configurado.');
 if(!cost)return result('UNKNOWN','Gasto não informado; sem faturamento conectado.');
 if(cost.currency!==currency)return result('UNKNOWN','Moedas diferentes; sem conversão automática.');
 if(!['INVOICE','ESTIMATE'].includes(cost.basis))return result('UNKNOWN','Origem do valor não conferida.');
 let amount:bigint;try{if(typeof cost.amount_minor==='number'&&!Number.isSafeInteger(cost.amount_minor))throw Error();if(!/^\d+$/.test(String(cost.amount_minor)))throw Error();amount=BigInt(cost.amount_minor);}catch{return result('UNKNOWN','Valor não confirmado.');}
 const limit=BigInt(budget),basis=cost.basis==='INVOICE'?'Fatura registrada':'Previsão estimada',hundredths=amount*BigInt(10000)/limit,percent=(hundredths/BigInt(100)).toString()+','+(hundredths%BigInt(100)).toString().padStart(2,'0')+'%';
 const high=amount*BigInt(100)>=limit*BigInt(80);
 return result(high?'WARNING':'NORMAL',basis+': '+percent+' do orçamento.'+(high?(cost.basis==='INVOICE'?' Aviso: gasto registrado atingiu 80% ou mais.':' Aviso de previsão: estimativa atingiu 80% ou mais; não é gasto realizado.'):'')+' Sem bloqueio automático.',percent);
}

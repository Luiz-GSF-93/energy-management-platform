import {feeCents,feeMoney} from '../contracts/services/management-fee';
export type InvestmentItem={category:string;description:string;amount:string;date:string;classification:'ESTIMATED'|'REALIZED';source:string;documentId?:string};
export function investmentReturn(snapshot:any,months:{month:string;totals:{savingsAfterFees:string}|null}[],end:string){
 const body=snapshot.body,items:InvestmentItem[]=body.items,eligible=items.filter(i=>i.date.slice(0,7)<=end),investment=eligible.reduce((n,i)=>n+feeCents(i.amount),0n);
 const base={formulaVersion:'energy-investment-return/1',investmentVersion:snapshot.version,investmentId:snapshot.id,investmentHash:snapshot.payload_hash,from:body.startMonth,to:end,investment:feeMoney(investment),items:eligible.map(i=>({category:i.category,description:i.description,amount:i.amount,date:i.date,classification:i.classification})),method:'SIMPLE_UNDISCOUNTED_CASH_FLOW',sourceStudy:body.sourceStudy??null};
 if(end<body.startMonth)return {...base,state:'BEFORE_TRACKING_START',roiPercent:null,paybackMonths:null};
 if(eligible.some(i=>i.classification!=='REALIZED'))return {...base,state:'ESTIMATED_INVESTMENT_PENDING',roiPercent:null,paybackMonths:null};
 const index=(m:string)=>Number(m.slice(0,4))*12+Number(m.slice(5));
 const expected=index(end)-index(body.startMonth)+1,rows=months.filter(m=>m.month>=body.startMonth&&m.month<=end).sort((a,b)=>a.month.localeCompare(b.month));
 if(rows.length!==expected||new Set(rows.map(m=>m.month)).size!==expected||rows.some((m,i)=>!m.totals||index(m.month)!==index(body.startMonth)+i))return {...base,state:'INCOMPLETE_PUBLISHED_COVERAGE',roiPercent:null,paybackMonths:null};
 if(investment===0n)return {...base,state:'NO_INVESTMENT',roiPercent:null,paybackMonths:null};
 let balance=-eligible.filter(i=>i.date.slice(0,7)<body.startMonth).reduce((n,i)=>n+feeCents(i.amount),0n),saving=0n,payback:bigint|null=null;
 const signed=(v:string)=>v.startsWith('-')?-feeCents(v.slice(1)):feeCents(v);
 const cashFlow=rows.map((m,i)=>{const cost=eligible.filter(v=>v.date.slice(0,7)===m.month).reduce((n,v)=>n+feeCents(v.amount),0n);balance-=cost;const before=balance,gain=signed(m.totals!.savingsAfterFees);saving+=gain;balance+=gain;
  if(before<0n&&balance>=0n&&gain>0n)payback=BigInt(i)*100n+((-before)*100n+gain/2n)/gain;
  if(balance<0n)payback=null;
  return {month:m.month,investment:feeMoney(cost),savings:feeMoney(gain),balance:feeMoney(balance)};
 });
 const net=saving-investment,abs=net<0n?-net:net,roi=(net<0n?'-':'')+feeMoney((abs*10000n+investment/2n)/investment);
 return {...base,state:'CALCULATED',savings:feeMoney(saving),netCash:feeMoney(net),roiPercent:roi,paybackMonths:payback===null?null:feeMoney(payback),paybackState:payback===null?'NOT_RECOVERED_IN_HORIZON':'RECOVERED_IN_HORIZON',cashFlow,disclosure:'ROI do horizonte, não anualizado. Payback simples sem desconto financeiro; não extrapola meses ausentes. Custos adicionais posteriores podem desfazer uma recuperação. Valores apurados não comprovam pagamento.'};
}

export function monthlyProjection(cost:number,month:string,now=new Date()){
 const start=Date.parse(month+'-01T00:00:00Z');
 if(!Number.isFinite(start)||now.getTime()<start)return null;
 const end=Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1);
 if(now.getTime()>=end)return cost;
 const elapsed=(now.getTime()-start)/86400000;
 return elapsed<1?null:Math.ceil(cost*(end-start)/86400000/elapsed);
}
export function brlMinor(amount:number,currency:string,rate:number|null){
 if(!Number.isSafeInteger(amount)||amount<0)throw Error('INVALID_COST');
 if(currency==='BRL')return amount;
 return rate&&Number.isFinite(rate)&&rate>0?Math.round(amount*rate):null;
}
export function budgetLevel(used:number,quota:number,projection:number|null){
 if(quota<=0)return null;
 if(used>=quota)return 'LIMIT';
 if(used>=quota*.95)return 'CRITICAL';
 if(used>=quota*.8)return 'WARNING';
 if(projection!==null&&projection>quota)return 'FORECAST';
 return null;
}

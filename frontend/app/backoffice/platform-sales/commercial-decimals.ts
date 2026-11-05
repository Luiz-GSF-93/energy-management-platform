// Decimal input only; persisted prices remain integer cents/basis points.
export function parseCommercialDecimal(raw:string):number|null {
 const text=raw.trim();
 if(!/^\d{1,10}([.,]\d{1,2})?$/.test(text))return null;
 const [whole,fraction='']=text.replace(',','.').split('.');
 const result=Number(whole)*100+Number(fraction.padEnd(2,'0'));
 return Number.isSafeInteger(result)?result:null;
}
export function commercialDecimal(value:number):string {
 return Math.floor(value/100)+','+String(value%100).padStart(2,'0');
}

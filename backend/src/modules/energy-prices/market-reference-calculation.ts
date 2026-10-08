export type MarketHour={start:string;submarket:'SE_CO'|'S'|'NE'|'N';value:number};
// Provider-neutral calculation engine: inputs must already be normalized and validated.
export function calculateMonthlyMarketReference(rows:MarketHour[],month:string){
 return (['SE_CO','S','NE','N'] as const).map(submarket=>{
  const values=rows.filter(row=>row.submarket===submarket);
  if(!values.length)throw new Error('MARKET_REFERENCE_EMPTY');
  return {month,submarket,hours:values.length,meanBrlMwh:Number((values.reduce((sum,row)=>sum+row.value,0)/values.length).toFixed(6))};
 });
}

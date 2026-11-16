/** New quotation notices have their own approved limits. Do not raise SMS/WhatsApp limits. */
export function quotationMailBudget(env:NodeJS.ProcessEnv=process.env){
 const integer=(value:string|undefined,max:number)=>value&&/^[1-9]\d{0,9}$/.test(value)&&Number(value)<=max?Number(value):null;
 const daily=integer(env.TRADING_QUOTE_MAIL_MAX_DAILY,100),budget=integer(env.TRADING_QUOTE_MAIL_MONTHLY_BUDGET_MICRO_USD,1000000000),email=integer(env.PORTAL_NOTIFICATION_EMAIL_COST_MICRO_USD,999999999);
 return daily&&budget&&email?{daily,budget,costs:{EMAIL:email}}:null;
}

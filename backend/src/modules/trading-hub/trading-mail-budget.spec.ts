import {quotationMailBudget} from './trading-mail-budget';
describe('quotation email budget',()=>{
 const env={TRADING_QUOTE_MAIL_MAX_DAILY:'50',TRADING_QUOTE_MAIL_MONTHLY_BUDGET_MICRO_USD:'5000000',PORTAL_NOTIFICATION_EMAIL_COST_MICRO_USD:'10000'};
 it('uses only the approved quotation notice limits without increasing other delivery channels',()=>{expect(quotationMailBudget({...env,PORTAL_NOTIFICATION_MAX_DAILY:'1',PORTAL_NOTIFICATION_MONTHLY_BUDGET_MICRO_USD:'10000'})).toEqual({daily:50,budget:5000000,costs:{EMAIL:10000}});});
 it('fails closed without explicit notice limits and a positive conservative email cost',()=>{expect(quotationMailBudget({})).toBeNull();for(const value of ['0','-1','NaN','1e2','101'])expect(quotationMailBudget({...env,TRADING_QUOTE_MAIL_MAX_DAILY:value})).toBeNull();expect(quotationMailBudget({...env,PORTAL_NOTIFICATION_EMAIL_COST_MICRO_USD:''})).toBeNull();});
});

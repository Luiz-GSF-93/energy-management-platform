import {tradingEmailHtml} from './trading-email-template';
import {sendTradingMail} from './trading-mail';
import {approvalNoticeHtml} from './trading-workflow-delivery';

describe('Trading transactional email',()=>{
 it('renders the approval notice with a fixed authenticated Portal link and escaped deadline',()=>{const html=approvalNoticeHtml('Prazo <img src=x>');expect(html).toContain('https://app.expertenergy.com.br/portal#aprovacoes-trading');expect(html).toContain('&lt;img src=x&gt;');expect(html).toContain('vencimento não significa aprovação');expect(()=>tradingEmailHtml({title:'x',intro:'x',footer:'x',actionUrl:'https://app.expertenergy.com.br/portal#aprovacoes-trading?redirect=evil'})).toThrow();});
 const base={title:'Cotação',intro:'Solicitação de proposta',footer:'Convite individual.'};
 it('escapes opportunity and contact content in HTML',()=>{
  const html=tradingEmailHtml({...base,title:'<script>alert(1)</script>',facts:[['Unidade','A&B <img src=x>']]});
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('A&amp;B &lt;img src=x&gt;');
  expect(html).not.toContain('<script>');
 });
 it.each(['javascript:alert(1)','https://outside.example/cotacao#123','https://app.expertenergy.com.br/cotacao?token=secret'])('rejects unsafe portal link %s',actionUrl=>{
  expect(()=>tradingEmailHtml({...base,actionUrl})).toThrow('Invalid Trading portal URL');
 });
 it('renders OTP and expiry without a navigation link',()=>{
  const html=tradingEmailHtml({...base,code:'123456',footer:'Válido por 10 minutos.'});
  expect(html).toContain('123456');expect(html).toContain('Válido por 10 minutos.');expect(html).not.toContain('href=');
 });
 it('sends HTML with a plain text alternative and stable idempotency key',async()=>{
  const previous={...process.env};const original=global.fetch;
  process.env.TRADING_RESEND_API_KEY='unit-test-only';process.env.TRADING_EMAIL_FROM='cotacoes@cotacoes.expertenergy.com.br';
  const mock=jest.fn().mockResolvedValue({ok:true,json:async()=>({id:'test-message'})});global.fetch=mock;
  try{
   const html=tradingEmailHtml(base);
   await expect(sendTradingMail('recipient@example.test','Cotação','Texto alternativo','invitation-test',html)).resolves.toBe('test-message');
   const [url,request]=mock.mock.calls[0];expect(url).toBe('https://api.resend.com/emails');
   expect(request.headers['Idempotency-Key']).toBe('invitation-test');
   expect(JSON.parse(request.body)).toEqual({from:'EnergyOS | Expert Energy <cotacoes@cotacoes.expertenergy.com.br>',to:['recipient@example.test'],subject:'Cotação',text:'Texto alternativo',html});
  }finally{global.fetch=original;process.env=previous;}
 });
});

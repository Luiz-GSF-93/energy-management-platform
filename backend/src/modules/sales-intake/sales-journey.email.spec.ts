import {commercialVerificationEmail} from './sales-journey.email';
describe('EnergyOS commercial email',()=>{
 it('renders the same code, validity and consent limits in HTML and plain text',()=>{const email=commercialVerificationEmail('012345');for(const body of [email.html,email.text]){expect(body).toContain('012345');expect(body).toContain('10 minutos');expect(body).toContain('não assina contrato nem autoriza cobrança');expect(body).toContain('Expert Energy');}expect(email.html).toContain('lang="pt-BR"');expect(email.html).not.toMatch(/<script|https?:\/\//);});
 it('refuses arbitrary content instead of inserting it into HTML',()=>{for(const code of ['12345','1234567','<img>','１２３４５６'])expect(()=>commercialVerificationEmail(code)).toThrow();});
});

import {invoiceAddressMatches,invoiceIdentityText} from './invoice-identity-preflight';
describe('installation address line comparison',()=>{
 const address='AV VINTE E UM DE MARCO, 520 CA A CENTRO';
 it('uses the same proof during intake and later invoice checks',()=>{const text='AV VINTE E UM DE MARCO, 520 CA A';expect(invoiceAddressMatches(text,address)).toBe(true);expect(invoiceIdentityText(text,{customerName:null,taxId:null,unitNumber:null,address,month:null}).checks.address).toBe('MATCH');});
 it.each(['AV VINTE E UM DE MARCO 5200 CA A','AV VINTE E UM DE MARCO 520 CA B','AV VINTE E UM DE MARCO 520','AV VINTE E UM DE MARCO 520 CA A OUTRO'])('preserves the full number/complement: %s',text=>expect(invoiceAddressMatches(text,address)).toBe(false));
 it('does not omit arbitrary registration suffixes',()=>expect(invoiceAddressMatches('AV VINTE E UM DE MARCO 520 CA A','AV VINTE E UM DE MARCO 520 CA A FILIAL')).toBe(false));
});

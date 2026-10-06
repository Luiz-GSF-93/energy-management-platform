import {invoiceSubmarket} from './acl-invoice-submarket';
describe('Submarket from invoice UC address',()=>{
 it('suggests SE/CO from the actual SP address block without losing provenance',()=>{const a='R PERU 2545 FD\nVL MARIANA\n14075-310 RIBEIRAO PRETO SP',r=invoiceSubmarket(a);expect(r).toMatchObject({address:a,uf:'SP',code:'SE_CO',status:'SUGGESTED',reviewRequired:true});});
 it('supports city-UF and does not equate geographic regions with electrical submarkets',()=>{expect(invoiceSubmarket('Porto Velho - RO').code).toBe('SE_CO');expect(invoiceSubmarket('Rio Branco - AC').code).toBe('SE_CO');expect(invoiceSubmarket('São Luís - MA').code).toBe('N');});
 it.each(['',null,'RUA SP','Cidade sem UF','14075-310 RIBEIRAO PRETO SP\n14000-000 CIDADE MG','00000-000 BOA VISTA RR','00000-000 CIDADE ZZ'])('leaves absent, ambiguous or unsupported assignments pending %s',address=>expect(invoiceSubmarket(address).code).toBeNull());
});

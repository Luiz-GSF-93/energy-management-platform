import {invoiceCustomerNameMatches as matches} from './invoice-customer-name';
describe('recipient legal form normalization',()=>{
 it('matches the exact business core across EIRELI and LTDA',()=>expect(matches('FABRICA DE PECAS EXEMPLO EIRELI','FABRICA DE PECAS EXEMPLO LTDA')).toBe(true));
 it('retains exact names and registered branch names',()=>{expect(matches('EMPRESA SINTETICA','EMPRESA SINTETICA')).toBe(true);expect(matches('EMPRESA SINTETICA','EMPRESA SINTETICA MATRIZ')).toBe(true);});
 it.each(['FABRICA DE PECAS EXEMPLO NOVA EIRELI','FABRICA DE PECAS EXEMPLO DOIS EIRELI','FABRICA DE PECAS EXEMPLO EIRELI CONTRATO','AV FABRICA DE PECAS EXEMPLO 246'])('does not fuzzy-match %s',name=>expect(matches(name,'FABRICA DE PECAS EXEMPLO LTDA')).toBe(false));
 it('keeps short names in review',()=>expect(matches('ABC EIRELI','ABC LTDA')).toBe(false));
});

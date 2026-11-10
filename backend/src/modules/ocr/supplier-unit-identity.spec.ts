import {supplierUnitIdentity,supplierUnitCodes} from './supplier-unit-identity';
const unit={unitNumber:'9000001',address:'Rua da Unidade 123 Centro',aliases:['7000001']};
const tax='11222333000181',branch='11222333000262';
describe('Fiscal recipient and supplied installation',()=>{
 it.each(['9000001','7000001'])('accepts a matrix recipient with proven UC %s and a different fiscal address',code=>{expect(supplierUnitIdentity(branch,tax,unit,[code],['Avenida da Matriz 900'],true)).toMatchObject({matched:true,matchedBy:'UNIT_CODE',addressMatch:false,taxIdentity:{accepted:true,relation:'SAME_ROOT'}});});
 it('accepts an address identifying the supplied branch when no UC is printed',()=>{expect(supplierUnitIdentity(branch,tax,unit,[],['Rua da Unidade 123 Centro CEP 12345-000'],true).matched).toBe(true);});
 it.each([{codes:['8000001']},{codes:['9000001','8000001']}])('blocks an explicit conflicting UC even when the address matches: %j',({codes})=>{expect(supplierUnitIdentity(tax,tax,unit,codes,[unit.address],true)).toMatchObject({matched:false,conflict:true});});
 it('does not infer installation or competence from the fiscal CNPJ alone',()=>{expect(supplierUnitIdentity(tax,tax,unit,[],['Avenida da Matriz 900'],true).matched).toBe(false);expect(supplierUnitIdentity(branch,tax,unit,[unit.unitNumber],[unit.address],false).matched).toBe(false);});
 it('rejects another corporate root and identifies only explicit installation labels',()=>{expect(supplierUnitIdentity(tax,'11444777000161',unit,[unit.unitNumber],[unit.address],true).matched).toBe(false);expect(supplierUnitCodes('NF 7000001 CNPJ 11222333000181 UC: 9.000.001 Instalação 7000001')).toEqual(['9.000.001','7000001']);});
});

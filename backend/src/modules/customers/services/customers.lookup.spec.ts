import {CustomersService} from './customers.service';
import {CustomersController} from '../controllers/customers.controller';
import {PERMISSIONS_KEY} from '../../../common/decorators/require-permission.decorator';
import {PERMISSIONS} from '../../../common/constants/permissions';
describe('CNPJ lookup boundary',()=>{
 const service=new CustomersService({} as any);const original=global.fetch;
 afterEach(()=>{global.fetch=original;});
 it('requires customer creation permission',()=>expect(Reflect.getMetadata(PERMISSIONS_KEY,CustomersController.prototype.lookupCnpj)).toEqual([PERMISSIONS.ORGANIZATION_CUSTOMERS_CREATE]));
 it('rejects bad checksum before network',async()=>{global.fetch=jest.fn();await expect(service.lookupCnpj('11222333000180')).rejects.toThrow('CNPJ inválido');expect(global.fetch).not.toHaveBeenCalled();});
 it('supports manual fallback for alphanumeric valid identifier',async()=>{global.fetch=jest.fn();await expect(service.lookupCnpj('12ABC34501DE35')).rejects.toThrow('alfanumérico');expect(global.fetch).not.toHaveBeenCalled();});
 it('only returns company fields, not shareholders or personal data',async()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({cnpj:'11222333000181',razao_social:'Empresa',nome_fantasia:'Marca',qsa:[{nome:'private'}],descricao_situacao_cadastral:'ATIVA'})});const result=await service.lookupCnpj('11.222.333/0001-81');expect(result).toEqual({cnpj:'11222333000181',company_name:'Empresa',trade_name:'Marca',registration_status:'ATIVA',source:'Minha Receita'});});
 it('does not accept data for another identifier',async()=>{global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({cnpj:'00000000000191',razao_social:'Wrong'})});await expect(service.lookupCnpj('11222333000181')).rejects.toThrow('Consulta indisponível');});
 it('reports missing entry without calling it invalid',async()=>{global.fetch=jest.fn().mockResolvedValue({status:404,ok:false});await expect(service.lookupCnpj('11222333000181')).rejects.toThrow('não encontrado');});
});

import {TariffLibraryController} from './tariff-library.controller';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
describe('Tariff library authorization',()=>{
 const svc={save:jest.fn(),apply:jest.fn()};const c=new TariffLibraryController(svc as any);
 const t=(permissions:string[])=>({organizationId:'org',userId:'actor',permissions} as any);
 beforeEach(()=>jest.clearAllMocks());
 it('cannot revise with create only',()=>{expect(()=>c.save({previousId:'old'} as any,t([P.ORGANIZATION_CONTRACTS_CREATE]))).toThrow();expect(svc.save).not.toHaveBeenCalled();});
 it('cannot create with update only',()=>{expect(()=>c.save({} as any,t([P.ORGANIZATION_CONTRACTS_UPDATE]))).toThrow();expect(svc.save).not.toHaveBeenCalled();});
 it('requires update for an application that may append monthly costs',()=>{expect(()=>c.apply('id',{} as any,t([P.ORGANIZATION_CONTRACTS_CREATE]))).toThrow();expect(svc.apply).not.toHaveBeenCalled();});
 it('passes authenticated scope and actor to revision',()=>{c.save({previousId:'old'} as any,t([P.ORGANIZATION_CONTRACTS_UPDATE]));expect(svc.save).toHaveBeenCalledWith({previousId:'old'},'org','actor');});
});

import {DocumentCatalogService} from './document-catalog.service';
import {PERMISSIONS as P} from '../../../common/constants/permissions';
const tenant:any={userId:'actor',organizationId:'a',scope:'organization',role:'operacional',permissions:[P.DOCUMENTS_VIEW,P.DOCUMENTS_UPDATE]};
describe('document catalog authorization',()=>{
 let service:DocumentCatalogService,db:any,licenses:any;
 beforeEach(()=>{db={rpc:jest.fn(async()=>({data:{revision:2}})),from:jest.fn()};licenses={requireEntitlement:jest.fn()};service=new DocumentCatalogService({getClient:()=>db} as any,licenses);});
 const input={revision:1,tag:'MODEL',reason:'Conferido no arquivo original e na fonte.',checkedDocument:true};
 it('denies global and consultation roles before reading data',async()=>{for(const t of [{...tenant,scope:'global'},{...tenant,role:'consulta'}])await expect(service.list(t)).rejects.toMatchObject({status:403});expect(db.from).not.toHaveBeenCalled();});
 it('requires update permission and current license',async()=>{await expect(service.save('doc',input,{...tenant,permissions:[P.DOCUMENTS_VIEW]})).rejects.toMatchObject({status:403});licenses.requireEntitlement.mockRejectedValue(new Error('revoked'));await expect(service.favorite('doc',{favorite:true},tenant)).rejects.toThrow('revoked');expect(db.rpc).not.toHaveBeenCalled();});
 it('rejects operator approval, unchecked evidence and injected scope',async()=>{await expect(service.save('doc',{...input,tag:'APPROVED'},tenant)).rejects.toMatchObject({status:403});await expect(service.save('doc',{...input,checkedDocument:false},tenant)).rejects.toMatchObject({status:400});await expect(service.save('doc',{...input,organizationId:'b'} as any,tenant)).rejects.toMatchObject({status:400});expect(db.rpc).not.toHaveBeenCalled();});
 it('binds actual actor and tenant to atomic classification',async()=>{await service.save('doc',input,tenant);expect(db.rpc).toHaveBeenCalledWith('save_document_catalog',{p_org:'a',p_actor:'actor',p_document:'doc',p_revision:1,p_tag:'MODEL',p_reason:input.reason,p_checked:true});});
 it('does not mask stale versions or revoked authorization',async()=>{db.rpc.mockResolvedValue({error:{code:'P2072'}});await expect(service.save('doc',input,tenant)).rejects.toMatchObject({status:409});db.rpc.mockResolvedValue({error:{code:'P2071'}});await expect(service.favorite('doc',{favorite:true},tenant)).rejects.toMatchObject({status:403});});
 it('favorites are scoped to actual user and cannot impersonate another',async()=>{await service.favorite('doc',{favorite:true},tenant);expect(db.rpc).toHaveBeenCalledWith('favorite_document',{p_org:'a',p_actor:'actor',p_document:'doc',p_favorite:true});await expect(service.favorite('doc',{favorite:true,actor:'other'} as any,tenant)).rejects.toMatchObject({status:400});});
});

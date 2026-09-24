import { resolvePlatformOperation } from './platform-operation';
describe('Platform organization operation',()=>{
 const id='11111111-1111-4111-8111-111111111111';
 const user={userId:id,email:'admin@example.com'};
 it.each([null,undefined,['one','two'],'not-a-session',''])('rejects malformed session %p',async session=>{
   const rpc=jest.fn();await expect(resolvePlatformOperation({rpc},session,user)).rejects.toThrow();expect(rpc).not.toHaveBeenCalled();
 });
 it.each([{data:[],error:null},{data:null,error:{code:'42501'}},{data:[{},{}],error:null},{data:[{}],error:null}])('denies unconfirmed RPC result',async result=>{
   await expect(resolvePlatformOperation({rpc:jest.fn().mockResolvedValue(result)},id,user)).rejects.toThrow();
 });
 it('keeps actor identity and uses only server-resolved organization and permissions',async()=>{
   const rpc=jest.fn().mockResolvedValue({data:[{organization_id:'org-a',organization_name:'Empresa A',role_id:'role-a',permissions:['view']}],error:null});
   const result=await resolvePlatformOperation({rpc},id,user);
   expect(rpc).toHaveBeenCalledWith('resolve_platform_organization_session',{target_session_id:id,target_user_id:user.userId});
   expect(result).toMatchObject({...user,organizationId:'org-a',scope:'organization',accessMode:'platform_operation',permissions:['view']});
 });
});

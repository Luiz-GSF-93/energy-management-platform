import {AuthService} from './auth.service';
describe('AuthService.acceptInvite',()=>{
 function setup(user:any,error:any=null){const getUserById=jest.fn().mockResolvedValue({data:{user},error});const updateUserById=jest.fn().mockResolvedValue({data:{user},error:null});const s=new AuthService({createAuthClient:()=>({auth:{admin:{getUserById,updateUserById}}})} as any,{} as any,{} as any);return {s,getUserById,updateUserById};}
 it('updates only the identity supplied by authenticated context',async()=>{const {s,updateUserById}=setup({id:'actor',invited_at:'2026-09-24'});await expect(s.acceptInvite('actor','long-test-password')).resolves.toEqual({success:true});expect(updateUserById).toHaveBeenCalledWith('actor',{password:'long-test-password'});});
 it.each([null,{id:'actor'}])('rejects missing invite %p',async(user)=>{const {s,updateUserById}=setup(user);await expect(s.acceptInvite('actor','long-test-password')).rejects.toThrow('Convite inválido');expect(updateUserById).not.toHaveBeenCalled();});
 it('surfaces password policy failure without secret output',async()=>{const {s,updateUserById}=setup({id:'actor',invited_at:'date'});updateUserById.mockResolvedValue({data:null,error:{message:'policy'}});await expect(s.acceptInvite('actor','long-test-password')).rejects.toThrow('requisitos de segurança');});
});

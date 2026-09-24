import {AuthService} from './auth.service';
describe('Authentication renewal',()=>{
 const renew=jest.fn();
 const service=new AuthService({createAuthClient:()=>({auth:{refreshSession:renew}})} as any,{} as any,{} as any);
 it('uses isolated auth client and returns only rotated token pair',async()=>{renew.mockResolvedValue({data:{session:{access_token:'new',refresh_token:'rotated',other:'private'}},error:null});expect(await service.renew('old')).toEqual({access_token:'new',refresh_token:'rotated'});expect(renew).toHaveBeenCalledWith({refresh_token:'old'});});
 it('rejects revoked refresh token without exposing upstream details',async()=>{renew.mockResolvedValue({data:{session:null},error:{status:400,message:'sensitive'}});await expect(service.renew('old')).rejects.toThrow('Sua sessão precisa de um novo login.');});
 it('distinguishes transient failure',async()=>{renew.mockResolvedValue({data:{session:null},error:{status:503}});await expect(service.renew('old')).rejects.toThrow('temporariamente');});
});

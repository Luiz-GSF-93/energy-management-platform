import 'reflect-metadata';
import {communicationFilters,PlatformCommunicationsController} from './platform-communications.controller';
import {PLATFORM_SCOPE_KEY} from '../../common/decorators/platform-scope.decorator';
import {PERMISSIONS_KEY} from '../../common/decorators/require-permission.decorator';
import {TEAM_MANAGE,PLATFORM_SUPPORT_VIEW} from '../platform-team/platform-team.permissions';
describe('platform communications read-only boundary',()=>{
 it('requires global Owner/support permission',()=>{expect(Reflect.getMetadata(PLATFORM_SCOPE_KEY,PlatformCommunicationsController)).toBe(true);expect(Reflect.getMetadata(PERMISSIONS_KEY,PlatformCommunicationsController.prototype.get)).toEqual([TEAM_MANAGE,PLATFORM_SUPPORT_VIEW]);});
 it.each([{page:'1001'},{page:'-1'},{start:'2026-02-30'},{start:'2026-10-11',end:'2026-10-10'},{start:'2024-01-01',end:'2026-10-10'},{organization:['a','b']},{token:'private'}])('rejects invalid filters %j',query=>{expect(()=>communicationFilters(query)).toThrow();});
 it('uses original authenticated actor and fixed read RPC',async()=>{const rpc=jest.fn().mockResolvedValue({data:{rows:[]}}),controller=new PlatformCommunicationsController({getClient:()=>({rpc})} as any);await controller.get({authenticatedUser:{userId:'original'}} as any,{organization:'a',receipt:'exact'});expect(rpc).toHaveBeenCalledWith('read_platform_communications',{p_actor:'original',p_filter:expect.objectContaining({organization:'a',receipt:'exact',page:'0'})});});
 it('does not expose provider/database error detail',async()=>{const controller=new PlatformCommunicationsController({getClient:()=>({rpc:async()=>({error:{message:'private credential'}})})} as any);await expect(controller.get({authenticatedUser:{userId:'actor'}} as any,{})).rejects.toThrow('Consulta indisponível');});
});

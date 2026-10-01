import {TariffLibraryService} from './tariff-library.service';
import {elektroTariffSeed} from './tariff-library-seed';
describe('TariffLibraryService security',()=>{
 const setup=()=>{const rpc=jest.fn().mockResolvedValue({data:{version:1},error:null});const db={getClient:jest.fn(()=>({rpc}))};const licenses={requireEntitlement:jest.fn().mockResolvedValue(undefined)};return{service:new TariffLibraryService(db as any,licenses as any),rpc,db,licenses};};
 it('licença bloqueada não chega ao banco',async()=>{const s=setup();s.licenses.requireEntitlement.mockRejectedValue(new Error('blocked'));await expect(s.service.save(elektroTariffSeed,'org','author')).rejects.toThrow('blocked');expect(s.db.getClient).not.toHaveBeenCalled();});
 it('autor e organização são obtidos do contexto autenticado',async()=>{const s=setup();await s.service.save(elektroTariffSeed,'org-a','actor-a');expect(s.rpc.mock.calls[0][1]).toMatchObject({p_org:'org-a',p_actor:'actor-a',p_previous:null});expect(s.rpc.mock.calls[0][1].p_profile.reason).toBeUndefined();});
 it('não aceita organização nem autor enviados no DTO',async()=>{const s=setup();await expect(s.service.save({...elektroTariffSeed,organization_id:'other',created_by:'spoof'} as any,'org','actor')).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();});
 it('revisão exige justificativa e autor',async()=>{const s=setup();await expect(s.service.save({...elektroTariffSeed,reason:' '},'org','actor')).rejects.toThrow();await expect(s.service.save(elektroTariffSeed,'org','')).rejects.toThrow();expect(s.rpc).not.toHaveBeenCalled();});
 it('trata conflito de revisão sem gravar outra versão silenciosa',async()=>{const s=setup();s.rpc.mockResolvedValue({data:null,error:{code:'P1352'}} as any);await expect(s.service.save(elektroTariffSeed,'org','actor')).rejects.toThrow('versão mudou');});
});

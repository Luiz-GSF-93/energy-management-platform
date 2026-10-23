import {EvaMarketController} from './eva-market.controller';
describe('market documentary guidance',()=>{
 const t={organizationId:'org'} as any,q={from:'2026-03-01',to:'2026-03-31',submarkets:'SE_CO'};
 function setup(){const read=jest.fn(async()=>({sourceFingerprint:'same',trends:[]}));const retrieve=jest.fn(async(..._args:any[])=>({state:'READY',evidence:[],sources:[],publicationProofs:[{id:'proof'}]}));const revalidate=jest.fn(async()=>undefined);return {read,retrieve,revalidate,controller:new EvaMarketController({read} as any,{retrieve,revalidate} as any)};}
 it('uses existing licensed retrieval and revalidates publications',async()=>{const s=setup();expect(await s.controller.guidance(t,q)).toMatchObject({organizationId:'org',sourceFingerprint:'same',knowledge:{state:'READY'}});expect(s.retrieve).toHaveBeenCalledTimes(1);expect(s.revalidate).toHaveBeenCalledTimes(1);expect(s.retrieve.mock.calls[0][2]).toEqual({periodStart:q.from,periodEnd:q.to,market:'ACL'});});
 it('discards guidance when the official price source changes during retrieval',async()=>{const s=setup();s.read.mockResolvedValueOnce({sourceFingerprint:'old',trends:[]}).mockResolvedValueOnce({sourceFingerprint:'new',trends:[]});await expect(s.controller.guidance(t,q)).rejects.toThrow('mudaram');});
 it('does not query the library without current price authorization',async()=>{const s=setup();s.read.mockRejectedValueOnce(Error('scope revoked'));await expect(s.controller.guidance(t,q)).rejects.toThrow();expect(s.retrieve).not.toHaveBeenCalled();});
 it('rejects hidden URLs and arbitrary prompts',async()=>{const s=setup();await expect(s.controller.guidance(t,{...q,url:'https://foreign.invalid'})).rejects.toThrow();expect(s.read).not.toHaveBeenCalled();});
});

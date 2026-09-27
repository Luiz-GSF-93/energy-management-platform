import {OcrController} from './ocr.controller';
describe('homologation endpoint',()=>{
 it('scopes all review sources to the authenticated organization and document',async()=>{const service=()=>({list:jest.fn(async()=>({fields:[]}))});const identity=service(),consumption=service(),demand=service();const controller=new OcrController({} as any,consumption as any,demand as any,{} as any,identity as any);const result=await controller.homologation('doc','org');for(const s of [identity,consumption,demand])expect(s.list).toHaveBeenCalledWith('org','doc');expect(result.canImport).toBe(false);});
 it('fails closed if any source cannot be verified',async()=>{const ok={list:async()=>({fields:[]})},bad={list:async()=>{throw Error('scope');}};const controller=new OcrController({} as any,ok as any,bad as any,{} as any,ok as any);await expect(controller.homologation('doc','other')).rejects.toThrow('scope');});
});

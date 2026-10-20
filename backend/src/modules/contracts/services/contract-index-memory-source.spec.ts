import {createHash} from 'node:crypto';
import {ContractIndexMemoryService} from './contract-index-memory.service';
import * as extractor from '../../ocr/eva-pdf-text.extractor';
const id='00000000-0000-4000-8000-000000000001',docId='00000000-0000-4000-8000-000000000002';
describe('internal contract source never authorizes internet',()=>{
 afterEach(()=>jest.restoreAllMocks());
 it('preserves PDF identity and extracts only a bounded unique annex',async()=>{
  const bytes=Buffer.from('%PDF-1.7 synthetic document source'),hash=createHash('sha256').update(bytes).digest('hex'),text='ANEXO I\nCONDIÇÕES DE SUPRIMENTO\nPERÍODO DE SUPRIMENTO 01/04/2024 A 31/12/2027\nENERGIA CONTRATADA 0,100000 MW médio\n01/01/2026 31/12/2026 118,00\nLIMITE INFERIOR 0,50 LIMITE SUPERIOR 1,40\nIPCA/IBGE\n5. REAJUSTE Data Base 1º Reajuste Periodicidade\n01/07/2023 01/04/2024 12 meses\nCNPJ 64.734.221/0001-76';
  jest.spyOn(extractor,'extractPdfText').mockResolvedValue({sections:[{page:21,text,hash:createHash('sha256').update(text).digest('hex'),issues:[]}]} as any);
  const doc={id:docId,file_verified:true,storage_bucket:'energy-documents-private',file_path:'org/unit/contract.pdf',file_hash:hash,file_size_bytes:bytes.length,original_filename:'Contrato.pdf'};
  const chain:any={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:doc})};
  const customer:any={select:()=>customer,eq:()=>customer,is:()=>customer,maybeSingle:async()=>({data:{document:'64.734.221/0001-76'}})};
  const rpc=jest.fn().mockResolvedValue({data:{contract:{id,customer_id:'customer',consumer_unit_id:'unit'}}}),download=jest.fn().mockResolvedValue({data:{arrayBuffer:async()=>bytes}}),http=jest.spyOn(global,'fetch').mockRejectedValue(Error('Forbidden'));
  const service=new ContractIndexMemoryService({getClient:()=>({rpc,from:(table:string)=>table==='customers'?customer:chain,storage:{from:()=>({download})}})} as any,{requireEntitlement:jest.fn()} as any,{get:()=> 'true'} as any);
  const result=await service.internalSource({contractId:id,documentId:docId,month:'2026-04'},{organizationId:'org',userId:'actor',roleId:'operator'} as any);
  expect(result.adjustment).toEqual({baseDate:'2023-07-01',firstAdjustment:'2024-04-01',frequencyMonths:12,index:'IPCA'});expect(result.annex).toMatchObject({state:'PROPOSED',price:'118.00'});expect(result.document.fileHash).toBe(hash);expect(http).not.toHaveBeenCalled();expect(rpc).toHaveBeenCalledTimes(1);
  customer.maybeSingle=async()=>({data:{document:'11.111.111/0001-11'}});const mismatch=await service.internalSource({contractId:id,documentId:docId,month:'2026-04'},{organizationId:'org',userId:'actor',roleId:'operator'} as any);expect(mismatch.annex.state).toBe('REVIEW');expect(mismatch.adjustment).toBeNull();expect(http).not.toHaveBeenCalled();
  doc.file_hash='a'.repeat(64);await expect(service.internalSource({contractId:id,documentId:docId,month:'2026-04'},{organizationId:'org',userId:'actor',roleId:'operator'} as any)).rejects.toThrow('Arquivo ou hash divergente');expect(http).not.toHaveBeenCalled();
 });
});

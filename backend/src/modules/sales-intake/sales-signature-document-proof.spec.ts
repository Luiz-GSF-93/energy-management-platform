import {originalDocumentProof,OriginalDocumentContext} from './sales-signature-document-proof';
import {signaturePdfHash} from './sales-signature-protocol';

const id='11111111-1111-4111-8111-111111111111',env='22222222-2222-4222-8222-222222222222',doc='33333333-3333-4333-8333-333333333333';
const pdf=Buffer.from('%PDF-1.7\n'+'x'.repeat(120)+'\n%%EOF');
function fixtures(){return {
 context:{signatureId:id,envelopeId:env,documentId:doc,draftSha256:signaturePdfHash(pdf)} as OriginalDocumentContext,
 parent:{data:{id:env,type:'envelopes',attributes:{name:`EnergyOS HOMOLOGAÇÃO ${id}`,status:'draft'}}},
 document:{data:{id:doc,type:'documents',attributes:{status:'draft',filename:`energyos-sandbox-${id}.pdf`}}},
};}
describe('Original document comparison (transport remains blocked)',()=>{
 it('binds matching bytes to the preserved context without accepting a signature',()=>{const f=fixtures();expect(originalDocumentProof(f.context,f.parent,f.document,pdf)).toEqual({externalId:doc,type:'documents',envelopeId:env,sha256:f.context.draftSha256,byteLength:pdf.length,environment:'SANDBOX',realActivationEligible:false});});
 it('rejects another PDF even with identical metadata and size',()=>{const f=fixtures(),other=Buffer.from(pdf);other[30]=121;expect(()=>originalDocumentProof(f.context,f.parent,f.document,other)).toThrow('bytes mismatch');});
 it.each(['signatureId','envelopeId','documentId','draftSha256'])('rejects invalid context %s',key=>{const f=fixtures();(f.context as any)[key]='invalid';expect(()=>originalDocumentProof(f.context,f.parent,f.document,pdf)).toThrow('context');});
 it('rejects a hash from another preserved source',()=>{const f=fixtures();f.context.draftSha256='0'.repeat(64);expect(()=>originalDocumentProof(f.context,f.parent,f.document,pdf)).toThrow('bytes mismatch');});
 it.each(['id','type','name','status'])('rejects envelope divergence %s',key=>{const f=fixtures();if(key==='name'||key==='status')f.parent.data.attributes[key]='running';else (f.parent.data as any)[key]='other';expect(()=>originalDocumentProof(f.context,f.parent,f.document,pdf)).toThrow('envelope mismatch');});
 it.each(['id','type','filename','status'])('rejects document divergence %s',key=>{const f=fixtures();if(key==='filename'||key==='status')f.document.data.attributes[key]='other';else (f.document.data as any)[key]='other';expect(()=>originalDocumentProof(f.context,f.parent,f.document,pdf)).toThrow('metadata mismatch');});
 it.each([Buffer.alloc(0),Buffer.alloc(150),Buffer.from('%PDF-1.7\n'+'x'.repeat(120))])('rejects malformed PDF %s',bytes=>{const f=fixtures();expect(()=>originalDocumentProof(f.context,f.parent,f.document,bytes)).toThrow();});
 it('rejects above 1 MiB even when hash is identical',()=>{const f=fixtures(),large=Buffer.from('%PDF-1.7\n'+'x'.repeat(1048576)+'\n%%EOF');f.context.draftSha256=signaturePdfHash(large);expect(()=>originalDocumentProof(f.context,f.parent,f.document,large)).toThrow('size invalid');});
 it('does not expose or use download URLs, raw content or arbitrary metadata',()=>{const f=fixtures();(f.document.data.attributes as any).downloads={original:'https://127.0.0.1/private?secret=example'};(f.document.data.attributes as any).token='private';const result=originalDocumentProof(f.context,f.parent,f.document,pdf);expect(JSON.stringify(result)).not.toMatch(/private|127\.0\.0\.1|downloads|token|%PDF/);});
 it('is deterministic and leaves source objects and bytes unchanged',()=>{const f=fixtures(),before=JSON.stringify(f),bytes=Buffer.from(pdf);expect(originalDocumentProof(f.context,f.parent,f.document,pdf)).toEqual(originalDocumentProof(f.context,f.parent,f.document,pdf));expect(JSON.stringify(f)).toBe(before);expect(pdf.equals(bytes)).toBe(true);});
 it('never calls fetch for a comparison',()=>{const spy=jest.spyOn(globalThis,'fetch').mockRejectedValue(new Error('Network forbidden'));try{const f=fixtures();originalDocumentProof(f.context,f.parent,f.document,pdf);expect(spy).not.toHaveBeenCalled();}finally{spy.mockRestore();}});
});

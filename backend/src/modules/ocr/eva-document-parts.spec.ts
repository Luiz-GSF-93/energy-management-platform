import {PDFDocument,StandardFonts} from 'pdf-lib';
import {ConfigService} from '@nestjs/config';
import {digest} from './eva-extraction.model';
import {PARTS_VERSION,validManifest,validOutput} from './eva-document-parts.model';
import {splitOfficialPdf} from './eva-document-parts.splitter';
import {EvaDocumentPartsService} from './eva-document-parts.service';
import {extractPdfText} from './eva-pdf-text.extractor';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const command={requestId:id(1),documentId:id(2),expectedEventId:id(3),expectedRevisionHash:'b'.repeat(64),operationId:id(4),justification:'Synthetic preparation; no external calls or official publication.'};
async function fixture(pages=101){const d=await PDFDocument.create(),font=await d.embedFont(StandardFonts.Helvetica);for(let i=1;i<=pages;i++){const p=d.addPage([400,500]);p.drawText(`Art. ${i} Synthetic fixture page ${i}`,{x:30,y:450,size:12,font});if(i===41){p.drawLine({start:{x:30,y:452},end:{x:240,y:452}});p.drawText('Replacement requires manual review',{x:30,y:430,size:10,font});}}return Buffer.from(await d.save());}
describe('Private long-document preparation',()=>{
 let bytes:Buffer,output:Awaited<ReturnType<typeof splitOfficialPdf>>;
 beforeAll(async()=>{bytes=await fixture();output=await splitOfficialPdf(bytes)},90000);
 beforeEach(()=>{jest.spyOn(globalThis,'fetch').mockImplementation(async()=>{throw Error('LIVE NETWORK FORBIDDEN')})});
 afterEach(()=>{if(jest.isMockFunction(globalThis.fetch))expect(globalThis.fetch).not.toHaveBeenCalled();jest.restoreAllMocks()});
 it('preserves all original pages and text geometry in bounded deterministic PDFs',async()=>{
  expect(validOutput(output)).toBe(true);expect(output.manifest).toMatchObject({version:PARTS_VERSION,originalPageCount:101,originalFileHash:digest(bytes)});
  expect(output.manifest.parts.map(p=>[p.startPage,p.endPage])).toEqual([[1,40],[41,80],[81,101]]);
  expect(output.manifest.parts.reduce((n,p)=>n+p.pageTextHashes.length,0)).toBe(101);
  expect((await splitOfficialPdf(bytes)).manifest).toEqual(output.manifest);
 },90000);
 it('reuses the existing parser for a derived part without raising its limits',async()=>{
  const r=await extractPdfText(output.files[1]);expect(r.pageCount).toBe(40);expect(r.sections[0].page).toBe(1);expect(r.sections[0].text).toContain('Art. 41');
 },90000);
 it.each(['gap','overlap','wrongHash','ordinal','truncated','tooLarge','badPageHash'])('rejects %s in the manifest',kind=>{
  const m=JSON.parse(JSON.stringify(output.manifest));if(kind==='gap')m.parts[1].startPage++;if(kind==='overlap')m.parts[1].startPage--;if(kind==='wrongHash')m.parts[1].fileHash=m.parts[0].fileHash;if(kind==='ordinal')m.parts.reverse();if(kind==='truncated')m.parts.pop();if(kind==='tooLarge')m.originalPageCount=501;if(kind==='badPageHash')m.parts[0].pageTextHashes[0]='bad';expect(validManifest(m)).toBe(false);
 });
 it('rejects tampered bytes against the preserved manifest',()=>{expect(validOutput({...output,files:[Buffer.from('tampered'),...output.files.slice(1)]})).toBe(false)});
 it.each([Buffer.from('not a PDF'),Buffer.from('%PDF- broken content that is not a valid PDF')])('rejects corrupt input',async b=>{await expect(splitOfficialPdf(b)).rejects.toThrow()});
 it('rejects short documents and interactive form content',async()=>{
  await expect(splitOfficialPdf(await fixture(1))).rejects.toThrow();const doc=await PDFDocument.load(bytes);doc.getForm().createTextField('hidden').addToPage(doc.getPage(0));await expect(splitOfficialPdf(Buffer.from(await doc.save()))).rejects.toThrow();
 },90000);
 it('defaults off before any RPC or local split',async()=>{
  const rpc=jest.fn(),s=new EvaDocumentPartsService({getClient:()=>({rpc})} as any,new ConfigService({}));
  await expect(s.prepare(id(8),command,{buffer:bytes,size:bytes.length,mimetype:'application/pdf'} as any)).rejects.toThrow('desligada');expect(rpc).not.toHaveBeenCalled();
 });
 it('rejects forged original bytes after preflight and before preparing anything',async()=>{
  const rpc=jest.fn(async(_name:string,_args:any)=>({data:{fileHash:'a'.repeat(64),size:bytes.length}})),s=new EvaDocumentPartsService({getClient:()=>({rpc})} as any,new ConfigService({EVA_DOCUMENT_PARTS_ENABLED:'true'}));
  await expect(s.prepare(id(8),command,{buffer:bytes,size:bytes.length,mimetype:'application/pdf'} as any)).rejects.toThrow('difere');expect(rpc).toHaveBeenCalledTimes(1);expect(rpc.mock.calls[0][1].p_action).toBe('original');
 });
 it('rechecks the Owner/original at commit and preserves uncertain results without retry',async()=>{
  const rpc=jest.fn(async(_name,args)=>args.p_action==='original'?{data:{fileHash:digest(bytes),size:bytes.length}}:{error:{code:'23505'}}),s=new EvaDocumentPartsService({getClient:()=>({rpc})} as any,new ConfigService({EVA_DOCUMENT_PARTS_ENABLED:'true'}));
  await expect(s.prepare(id(8),command,{buffer:bytes,size:bytes.length,mimetype:'application/pdf'} as any)).rejects.toThrow('alteradas');expect(rpc.mock.calls.map(c=>c[1].p_action)).toEqual(['original','prepare']);
 },90000);
 it('rejects overposting and malformed links before the RPC',()=>{
  const rpc=jest.fn(),s=new EvaDocumentPartsService({getClient:()=>({rpc})} as any,new ConfigService({EVA_DOCUMENT_PARTS_ENABLED:'true'}));expect(()=>s.command(id(8),id(9),'review',{requestId:id(10),expectedSetId:id(9),justification:command.justification,actorId:id(11)})).toThrow();expect(()=>s.list(id(8),{organizationId:'other'})).toThrow();expect(rpc).not.toHaveBeenCalled();
 });
});

import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {dirname,join,sep} from 'node:path';
import {ExtractionError,digest} from './eva-extraction.model';
import {PARTS_LIMITS,PARTS_VERSION,PartOutput,validOutput} from './eva-document-parts.model';
// Fixed local program. Input PDF scripts, links, attachments and actions are not run.
const program=String.raw`
const {parentPort,workerData:d}=require('node:worker_threads');
const {createHash}=require('node:crypto');
const digest=b=>createHash('sha256').update(b).digest('hex');
(async()=>{let original,originalTask;try{
 const {PDFDocument,PDFName,PDFArray,PDFDict}=require(d.lib),pdfjs=await import(d.module);
 const options={verbosity:0,enableXfa:false,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,stopAtErrors:true,standardFontDataUrl:d.fonts,cMapUrl:d.cmaps,cMapPacked:true,wasmUrl:d.wasm};
 const source=await PDFDocument.load(d.bytes,{ignoreEncryption:false,updateMetadata:false});
 if(source.getForm().getFields().length)throw Error('PDF_INVALID');
 for(const p of source.getPages()){
  const ann=p.node.lookupMaybe(PDFName.of('Annots'),PDFArray);
  if(ann)for(let i=0;i<ann.size();i++){const a=ann.lookup(i,PDFDict);if(a.get(PDFName.of('Subtype'))?.toString()!=='/Link')throw Error('PDF_INVALID');}
 }
 const count=source.getPageCount();if(count<101||count>d.maxPages)throw Error('LIMIT');
 originalTask=pdfjs.getDocument({...options,data:Uint8Array.from(d.bytes)});original=await originalTask.promise;
 if(original.numPages!==count)throw Error('INTEGRITY');
 // Compare text geometry and page boxes, rather than page counts alone.
 const signature=async(doc,n)=>{const page=await doc.getPage(n),text=await page.getTextContent();const value=JSON.stringify({view:page.view,rotate:page.rotate,items:text.items.filter(x=>typeof x.str==='string').map(x=>[x.str,x.transform,x.width,x.height,x.hasEOL])});page.cleanup();return {hash:digest(value),size:Buffer.byteLength(value)};};
 let textBytes=0,fileBytes=0;const parts=[],files=[];
 for(let start=1;start<=count;start+=d.partPages){
  const end=Math.min(count,start+d.partPages-1),doc=await PDFDocument.create();
  const pages=await doc.copyPages(source,Array.from({length:end-start+1},(_,i)=>start+i-1));for(const p of pages)doc.addPage(p);
  // Copy page visuals/content only, never interactive actions or attachments.
  for(const p of doc.getPages()){p.node.delete(PDFName.of('Annots'));p.node.delete(PDFName.of('AA'));}
  doc.setCreationDate(new Date('2000-01-01T00:00:00Z'));doc.setModificationDate(new Date('2000-01-01T00:00:00Z'));
  const bytes=await doc.save({useObjectStreams:false,addDefaultPage:false});fileBytes+=bytes.length;if(bytes.length>d.maxBytes||fileBytes>50*1024*1024)throw Error('LIMIT');
  let derived,derivedTask;const hashes=[];try{
   derivedTask=pdfjs.getDocument({...options,data:Uint8Array.from(bytes)});derived=await derivedTask.promise;
   if(derived.numPages!==end-start+1)throw Error('INTEGRITY');
   for(let n=start;n<=end;n++){const a=await signature(original,n),b=await signature(derived,n-start+1);textBytes+=a.size;if(textBytes>8*1024*1024)throw Error('LIMIT');if(a.hash!==b.hash)throw Error('INTEGRITY');hashes.push(a.hash);}
  }finally{if(derivedTask)await derivedTask.destroy();}
  parts.push({ordinal:parts.length+1,startPage:start,endPage:end,pageCount:end-start+1,fileHash:digest(bytes),size:bytes.length,pageTextHashes:hashes});files.push(bytes);
 }
 parentPort.postMessage({manifest:{version:d.version,originalFileHash:d.hash,originalPageCount:count,parts},files});
}catch(e){parentPort.postMessage({error:['LIMIT','INTEGRITY'].includes(e?.message)?e.message:'PDF_INVALID'});}finally{if(originalTask)await originalTask.destroy();}})();`;
export async function splitOfficialPdf(bytes:Buffer):Promise<PartOutput>{
 if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.length>PARTS_LIMITS.bytes||!bytes.subarray(0,10).toString('ascii').startsWith('%PDF-'))throw new ExtractionError('PDF_INVALID');
 const root=dirname(require.resolve('pdfjs-dist/package.json'));
 return new Promise((resolve,reject)=>{
  const asset=(name:string)=>join(root,name).split(sep).join('/')+'/';
  const worker=new Worker(program,{eval:true,workerData:{bytes:Uint8Array.from(bytes),hash:digest(bytes),lib:require.resolve('pdf-lib'),module:pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href,fonts:asset('standard_fonts'),cmaps:asset('cmaps'),wasm:asset('wasm'),partPages:PARTS_LIMITS.partPages,maxPages:PARTS_LIMITS.pages,maxBytes:PARTS_LIMITS.bytes,version:PARTS_VERSION},resourceLimits:{maxOldGenerationSizeMb:384,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  let settled=false;const finish=(value?:PartOutput,code?:'LIMIT'|'INTEGRITY'|'PDF_INVALID')=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();value?resolve(value):reject(new ExtractionError(code??'PDF_INVALID'));};
  const timer=setTimeout(()=>finish(undefined,'LIMIT'),PARTS_LIMITS.timeoutMs);
  worker.once('message',v=>{if(v?.error){finish(undefined,['LIMIT','INTEGRITY'].includes(v.error)?v.error:'PDF_INVALID');return;}const output={manifest:v?.manifest,files:v?.files?.map((b:Uint8Array)=>Buffer.from(b))};validOutput(output)?finish(output):finish(undefined,'INTEGRITY');});
  worker.once('error',()=>finish());worker.once('exit',()=>finish());
 });
}

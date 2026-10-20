import {Worker} from 'node:worker_threads';
import {pathToFileURL} from 'node:url';
import {dirname,join,sep} from 'node:path';
import {ExtractionError,ExtractionResult,EXTRACTION_LIMITS,validateExtractionResult} from './eva-extraction.model';
// Static worker program. PDF text, URLs, scripts and attachments are never evaluated.
const program=String.raw`
const {parentPort,workerData}=require('node:worker_threads');
const {createHash}=require('node:crypto');
const digest=s=>createHash('sha256').update(s).digest('hex');
const fail=code=>{parentPort.postMessage({error:code});};
(async()=>{
 let pdf;
 try{
  const lib=await import(workerData.module);
  pdf=await lib.getDocument({data:workerData.bytes,verbosity:0,enableXfa:false,standardFontDataUrl:workerData.fontDir,cMapUrl:workerData.cMapDir,cMapPacked:true,wasmUrl:workerData.wasmDir,isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,disableAutoFetch:true,disableStream:true,stopAtErrors:true}).promise;
  if(pdf.numPages<1||pdf.numPages>100){fail('LIMIT');return;}
  const sections=[];let textBytes=0,ocrRequired=false;
  for(let page=1;page<=pdf.numPages;page++){
   const p=await pdf.getPage(page),content=await p.getTextContent({includeMarkedContent:false});
   let text='',layout=false,lastX=0,lastY=NaN;
   for(const item of content.items){if(typeof item.str!=='string')continue;
    const x=item.transform?.[4]??0,y=item.transform?.[5]??0;
    if(x<p.view[0]-2||x>p.view[2]+2||y<p.view[1]-2||y>p.view[3]+2)layout=true;
    if(Number.isFinite(lastY)&&Math.abs(lastY-y)<2&&x-lastX>220)layout=true;
    if(text&&!text.endsWith('\n'))text+=' ';
    text+=item.str.replace(/\u0000/g,'');if(item.hasEOL)text+='\n';lastX=x+(item.width??0);lastY=y;
   }
   const ops=await p.getOperatorList();
   if(ops.fnArray.some((op,i)=>op===lib.OPS.setTextRenderingMode&&ops.argsArray[i]?.[0]===3||op===lib.OPS.setGState&&ops.argsArray[i]?.[0]?.some?.(entry=>['ca','CA'].includes(entry[0])&&entry[1]<0.05)))layout=true;
   const imageOps=[lib.OPS.paintImageXObject,lib.OPS.paintInlineImageXObject,lib.OPS.paintImageMaskXObject,lib.OPS.paintImageXObjectRepeat,lib.OPS.paintImageMaskXObjectRepeat].filter(x=>typeof x==='number');
   const images=ops.fnArray.some(x=>imageOps.includes(x));
   const issues=[];if(!text.trim()){issues.push('EMPTY_PAGE');ocrRequired=true;}
   if(images){issues.push('IMAGE_PRESENT');if(text.trim().length<30)ocrRequired=true;}
   if(layout||text.includes('\ufffd'))issues.push('LAYOUT_REVIEW');
   textBytes+=Buffer.byteLength(text);if(textBytes>2097152){fail('LIMIT');return;}
   const headings=[];const re=/^(?:Art\.?\s*\d+[^\n]*|CAP[IÍ]TULO[^\n]*|SE[CÇ][AÃ]O[^\n]*|ANEXO[^\n]*|M[OÓ]DULO[^\n]*)/gim;let m;
   while((m=re.exec(text)))headings.push({offset:m.index,label:m[0].slice(0,200)});
   if(!headings.length||headings[0].offset>0)headings.unshift({offset:0,label:''});
   for(let hi=0;hi<headings.length;hi++){
    let start=headings[hi].offset;const finish=headings[hi+1]?.offset??text.length;
    do{let end=Math.min(finish,start+2800);
     if(end<finish){const candidate=text.lastIndexOf(' ',end);if(candidate>start+1800)end=candidate;if(text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;}
     const value=text.slice(start,end);sections.push({page,start,end,heading:headings[hi].label,text:value,hash:digest(value),issues});
     if(sections.length>2000){fail('LIMIT');return;}start=end;
    }while(start<finish);
   }
   p.cleanup();
  }
  const result={pageCount:pdf.numPages,sections,ocrRequired};
  parentPort.postMessage({...result,contentHash:digest(JSON.stringify(result))});
 }catch(e){fail(e?.name==='PasswordException'?'PDF_INVALID':'EXTRACTION_FAILED');}
 finally{if(pdf)await pdf.destroy();}
})();`;
export async function extractPdfText(bytes:Buffer,timeoutMs=EXTRACTION_LIMITS.timeoutMs):Promise<ExtractionResult>{
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>EXTRACTION_LIMITS.timeoutMs)throw new ExtractionError('LIMIT');
 if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.length>EXTRACTION_LIMITS.bytes||!bytes.subarray(0,10).toString('ascii').startsWith('%PDF-'))throw new ExtractionError('PDF_INVALID');
 const module=pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href;
 const root=dirname(require.resolve('pdfjs-dist/package.json'));
 return new Promise((resolve,reject)=>{
  const asset=(name:string)=>join(root,name).split(sep).join('/')+'/';
  const worker=new Worker(program,{eval:true,workerData:{bytes:Uint8Array.from(bytes),module,fontDir:asset('standard_fonts'),cMapDir:asset('cmaps'),wasmDir:asset('wasm')},resourceLimits:{maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32,stackSizeMb:4}});
  let settled=false;
  const finish=(value?:ExtractionResult,code?:ExtractionError['code'])=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();value?resolve(value):reject(new ExtractionError(code??'EXTRACTION_FAILED'));};
  const timer=setTimeout(()=>finish(undefined,'LIMIT'),timeoutMs);
  worker.once('message',v=>{if(v?.error)finish(undefined,['LIMIT','PDF_INVALID'].includes(v.error)?v.error:'EXTRACTION_FAILED');else if(validateExtractionResult(v))finish(v);else finish(undefined,'INTEGRITY')});
  worker.once('error',()=>finish());worker.once('exit',()=>finish());
 });
}

// Acquisition only: downloaded snapshots are NOT automatically legally reviewed.
// Run with an absolute output directory outside the repository; never send secrets.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const sources=[
 ['REN_1000','https://www2.aneel.gov.br/cedoc/ren20211000.pdf'],
 ['REN_1059','https://www2.aneel.gov.br/cedoc/ren20231059.pdf'],
 ['LAW_14300','https://www.planalto.gov.br/ccivil_03/_ato2019-2022/2022/lei/l14300.htm'],
 ['PRODIST_5','https://git.aneel.gov.br/publico/centralconteudo/-/raw/main/procreg/prodist/modulo05/aren2021956_Prodist_modulo_5_v7.pdf'],
 ['PRODIST_11','https://git.aneel.gov.br/publico/centralconteudo/-/raw/main/procreg/prodist/modulo11/aren2021956_Prodist_modulo_11_v2.pdf'],
 ['CCEE_1_8','https://www.ccee.org.br/o/ccee/documentos/CCEE_1179201'],
 ['CCEE_1_4','https://www.ccee.org.br/documents/80415/29314541/1.4_-_Atendimento_v10.0.pdf/25ac4be0-f111-f590-8d6d-a37c722e351a'],
];
async function acquire(out){
 if(!path.isAbsolute(out))throw Error('Absolute corpus directory required');
 await fs.mkdir(out,{recursive:true});const manifest=[];
 for(const [family,url] of sources){
  const entry={family,url,state:'PENDING',fetchedAt:new Date().toISOString()};
  try{
   const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok||!response.body)throw Error('OFFICIAL_SOURCE_UNAVAILABLE');
   const reader=response.body.getReader(),parts=[];let size=0;
   try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>20000000){await reader.cancel();throw Error('SOURCE_LIMIT');}parts.push(Buffer.from(next.value));}}finally{reader.releaseLock();}
   const bytes=Buffer.concat(parts),pdf=response.headers.get('content-type')?.includes('application/pdf')||url.endsWith('.pdf');
   if(pdf&&!bytes.subarray(0,5).equals(Buffer.from('%PDF-'))||!pdf&&!response.headers.get('content-type')?.includes('text/html'))throw Error('INVALID_DOCUMENT_FORMAT');
   const hash=crypto.createHash('sha256').update(bytes).digest('hex'),filename=family+'-'+hash+(pdf?'.pdf':'.html');
   await fs.writeFile(path.join(out,filename),bytes,{flag:'wx'}).catch(e=>{if(e.code!=='EEXIST')throw e;});
   Object.assign(entry,{state:'ACQUIRED_NOT_REVIEWED',bytes:size,documentHash:hash,filename,contentType:response.headers.get('content-type')});
  }catch{entry.state='SOURCE_UNAVAILABLE';}
  manifest.push(entry);
 }
 await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({sources:manifest,pendingFamilies:['ANEEL_RULES_ADDITIONAL','CCEE_MODULES','ONS_MODULES'],indexed:false},null,2));
 console.log(JSON.stringify({acquired:manifest.filter(e=>e.state==='ACQUIRED_NOT_REVIEWED').length,unavailable:manifest.filter(e=>e.state==='SOURCE_UNAVAILABLE').length,indexed:false}));
}
if(require.main===module)acquire(process.argv[2]??'').catch(()=>{console.error('Corpus acquisition failed.');process.exitCode=1;});
module.exports={acquire};

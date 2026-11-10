export type EvaUploadItem={file:File;requestId:string;state:'pending'|'sending'|'received'|'uncertain';message?:string};
export function validateEvaFiles(files:File[]){
 if(!files.length||files.length>10)return 'Selecione de 1 a 10 arquivos por envio.';
 if(files.reduce((total,f)=>total+f.size,0)>50*1024*1024)return 'O conjunto deve ter até 50 MB. Divida os arquivos em mais de um envio.';
 for(const file of files){
  const xml=/\.xml$/i.test(file.name)||file.type.includes('xml');
  if(!/\.(pdf|xml|jpe?g|png)$/i.test(file.name))return 'Utilize PDF, XML fiscal, JPEG ou PNG.';
  if(file.size<20||file.size>(xml?2:15)*1024*1024)return file.name+': utilize XML de até 2 MB ou PDF/imagem de até 15 MB.';
 }
 return '';
}
/** Sequential transport uses the existing tenant-scoped endpoint and its quotas.
 * Unknown acknowledgements retain their request ID; received items are skipped. */
export async function sendEvaBatch(items:EvaUploadItem[],customerId:string|undefined,post:(body:FormData)=>Promise<unknown>,update:(items:EvaUploadItem[])=>void){
 const next=items.map(item=>({...item}));
 for(const item of next){
  if(item.state==='received')continue;
  item.state='sending';item.message='Enviando…';update(next.map(v=>({...v})));
  const body=new FormData();body.set('file',item.file);body.set('requestId',item.requestId);body.set('consent','true');if(customerId)body.set('customerId',customerId);
  try{await post(body);item.state='received';item.message='Recebido · a EVA continuará o preenchimento';}
  catch(error){item.state='uncertain';item.message=error instanceof Error?error.message:'Envio não confirmado. Consulte o andamento e tente novamente neste envio.';update(next.map(v=>({...v})));return {items:next,complete:false};}
  update(next.map(v=>({...v})));
 }
 return {items:next,complete:true};
}

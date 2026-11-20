import{mkdtemp,writeFile,readFile,rm,stat}from'node:fs/promises';
import{tmpdir}from'node:os';import{join,resolve,sep}from'node:path';import{execFile}from'node:child_process';import{promisify}from'node:util';
import{ProjectError}from'./project-policy.mjs';
const execute=promisify(execFile);let rendering=false;
export async function renderDocumentPage(bytes,page,{run=execute}={}){
 if(!Number.isInteger(page)||page<1||page>250||bytes.length>20971520||bytes.subarray(0,5).toString()!=='%PDF-')throw new ProjectError('Documento ou página não disponível para consulta.',422);
 if(rendering)throw new ProjectError('Uma página está sendo preparada. Aguarde e tente novamente.',429);rendering=true;let folder;
 try{
  folder=await mkdtemp(join(tmpdir(),'pee-document-view-'));const input=join(folder,'source.pdf'),output=join(folder,'page');await writeFile(input,bytes,{mode:0o600});
  const info=await run('pdfinfo',[input],{timeout:8000,maxBuffer:65536,windowsHide:true});const total=Number(/^Pages:\s+(\d+)\s*$/m.exec(info.stdout)?.[1]);
  if(!Number.isInteger(total)||total<1||total>250||page>total)throw new ProjectError('Página não disponível ou documento acima de 250 páginas.',422);
  await run('pdftoppm',['-f',String(page),'-l',String(page),'-singlefile','-scale-to','1600','-png',input,output],{timeout:10000,maxBuffer:65536,windowsHide:true});
  if((await stat(output+'.png')).size>10485760)throw new ProjectError('Página acima do limite de consulta.',422);
  const image=await readFile(output+'.png');if(image.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('INVALID_PREVIEW');return{image,total};
 }catch(e){if(e instanceof ProjectError)throw e;throw new ProjectError('Não foi possível preparar esta página. O original permanece preservado. Consulte o responsável.',503);}
 finally{rendering=false;if(folder&&resolve(folder).startsWith(resolve(tmpdir())+sep)&&folder.split(sep).at(-1).startsWith('pee-document-view-'))await rm(folder,{recursive:true,force:true});}
}

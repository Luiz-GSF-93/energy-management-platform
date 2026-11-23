import{randomUUID,createHash}from'node:crypto';
import{inflateRawSync}from'node:zlib';
import{PDFDocument}from'pdf-lib';
import{ProjectError}from'./project-policy.mjs';
import{renderDocumentPage}from'./document-viewer.mjs';
const fail=(m,s=422)=>{throw new ProjectError(m,s);};
const digest=b=>createHash('sha256').update(b).digest('hex');
const decode=s=>String(s??'').replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(Math.min(0x10ffff,v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1)))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[v.toLowerCase()]));
function xlsxEntries(bytes){
 let end=-1;for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)fail('Planilha inválida para consulta.');const count=bytes.readUInt16LE(end+10);let at=bytes.readUInt32LE(end+16),total=0;const result=new Map();
 if(count>1000||at>=end)fail('Planilha acima do limite de consulta.');
 for(let i=0;i<count;i++){
  if(at+46>end||bytes.readUInt32LE(at)!==0x02014b50)fail('Estrutura de planilha inválida.');
  const flags=bytes.readUInt16LE(at+8),method=bytes.readUInt16LE(at+10),size=bytes.readUInt32LE(at+24),packed=bytes.readUInt32LE(at+20),nameSize=bytes.readUInt16LE(at+28),extra=bytes.readUInt16LE(at+30),comment=bytes.readUInt16LE(at+32),offset=bytes.readUInt32LE(at+42),name=bytes.subarray(at+46,at+46+nameSize).toString('utf8');at+=46+nameSize+extra+comment;
  if(!/^(xl\/(sharedStrings|workbook)\.xml|xl\/worksheets\/sheet\d+\.xml)$/.test(name))continue;
  if(result.has(name)||flags&1||![0,8].includes(method)||size>8000000||(total+=size)>16000000||offset+30>bytes.length||bytes.readUInt32LE(offset)!==0x04034b50)fail('Planilha protegida ou acima do limite de consulta.');
  const start=offset+30+bytes.readUInt16LE(offset+26)+bytes.readUInt16LE(offset+28);if(start+packed>bytes.length)fail('Planilha incompleta.');
  const raw=bytes.subarray(start,start+packed),data=method===8?inflateRawSync(raw,{maxOutputLength:8000000}):raw;if(data.length!==size)fail('Integridade da planilha não confirmada.');const xml=data.toString('utf8');if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('Planilha com conteúdo externo não permitido.');result.set(name,xml);
 }return result;
}
export function workbookView(bytes){
 const entries=xlsxEntries(bytes),texts=s=>[...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>decode(m[1])).join(''),shared=[...(entries.get('xl/sharedStrings.xml')??'').matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1])),names=[...(entries.get('xl/workbook.xml')??'').matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map(m=>decode(m[1]));
 const lines=['Consulta de planilha · valores e fórmulas registrados no arquivo. Macros, fórmulas e vínculos externos não são executados. A representação em tela não reproduz toda a formatação do Excel.'];let cells=0,index=0;
 for(const[name,xml]of entries){if(!/^xl\/worksheets\/sheet\d+\.xml$/.test(name))continue;lines.push('',names[index++]??name);
  for(const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)){
   const values=[];for(const c of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)){if(++cells>100000)fail('Planilha acima de 100.000 células; envie uma versão PDF dividida em volumes.');const type=/\bt="([^"]*)"/.exec(c[1])?.[1],ref=/\br="([^"]*)"/.exec(c[1])?.[1]??'',raw=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(c[2])?.[1]??'',formula=/<f(?:\s[^>]*)?>([\s\S]*?)<\/f>/.exec(c[2])?.[1];const value=type==='s'?shared[Number(raw)]??'':type==='inlineStr'?texts(c[2]):decode(raw);values.push(ref+': '+value+(formula?' [fórmula: '+decode(formula)+']':''));}lines.push(values.join('  |  '));
  }
 }if(index===0)fail('Nenhuma aba disponível para consulta.');return lines.join('\n');
}
export async function controlledPage(bytes,mime,page,{renderer=renderDocumentPage}={}){
 if(!Number.isInteger(page)||page<1||bytes.length>20971520)fail('Arquivo ou página indisponível.');
 if(mime==='application/pdf'){const r=await renderer(bytes,page);return{kind:'image',data:'data:image/png;base64,'+r.image.toString('base64'),total:r.total,page};}
 if(['image/png','image/jpeg'].includes(mime)){if(page!==1)fail('Página indisponível.');const valid=mime==='image/png'?bytes.length>=24&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a':bytes[0]===255&&bytes[1]===216&&bytes[2]===255;if(!valid)fail('Imagem inválida.');if(mime==='image/png'&&bytes.readUInt32BE(16)*bytes.readUInt32BE(20)>16000000)fail('Imagem acima do limite de consulta.');const pdf=await PDFDocument.create(),image=mime==='image/png'?await pdf.embedPng(bytes):await pdf.embedJpg(bytes);if(image.width*image.height>16000000)fail('Imagem acima do limite de consulta.');const p=pdf.addPage([image.width,image.height]);p.drawImage(image,{x:0,y:0,width:image.width,height:image.height});const r=await renderer(Buffer.from(await pdf.save()),1);return{kind:'image',data:'data:image/png;base64,'+r.image.toString('base64'),total:1,page};}
 if(!['text/plain','text/csv','application/json','text/html','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime))fail('Formato indisponível para consulta segura. Solicite uma representação PDF ao responsável.');
 const text=mime.endsWith('spreadsheetml.sheet')?workbookView(bytes):bytes.toString('utf8'),lines=text.replace(/\r\n/g,'\n').split('\n'),total=Math.max(1,Math.ceil(lines.length/50));if(page>total)fail('Página indisponível.');return{kind:'text',text:lines.slice((page-1)*50,page*50).join('\n'),total,page};
}
export function createControlledViews({store,get,renderer=renderDocumentPage}={}){
 const items=new Map();const prune=()=>{const now=Date.now();for(const[k,v]of items)if(v.until<now)items.delete(k);};
 return{
  register(c,{bytes,mime,name,project_id}){prune();if(!project_id||bytes.length>20971520)fail('Consulta acima do limite permitido.');let size=0;for(const v of items.values())size+=v.bytes.length;if(items.size>=24||size+bytes.length>64000000)fail('Aguarde a liberação das consultas em andamento.',429);const id=randomUUID();items.set(id,{tenant:c.tenant,subject:c.subject,bytes,mime,name,project_id,until:Date.now()+600000});return{name,page_url:'/api/app/views/'+id+'/pages/'};},
  async handle(req,res,path,c,{send}){const m=/^\/api\/app\/views\/([a-f0-9-]{36})\/pages\/(\d{1,5})$/.exec(path);if(!m)return false;prune();const v=items.get(m[1]);if(req.method!=='GET'||!v||v.tenant!==c.tenant||v.subject!==c.subject||c.role==='finance')fail('Consulta indisponível. Abra o documento novamente no seu projeto.',404);await get(c,v.project_id,'project');const result=await controlledPage(v.bytes,v.mime,Number(m[2]),{renderer});await store.security(c,'document_viewed',{project_id:v.project_id,page:Number(m[2]),sha256:digest(v.bytes),display_name:c.display_name,controlled:true});v.until=Date.now()+600000;send(res,200,{...result,name:v.name,control:'by EnergyOS PEE · consulta '+m[1]+' · SHA-256 '+digest(v.bytes)});return true;}
 };
}

import {createHash} from 'node:crypto';
export type SourceOrigin='ocr'|'energy'|'management'|'license';
export function alertDay(value:unknown):string|null {
 if(typeof value!=='string')return null;const day=value.slice(0,10);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return null;
 const d=new Date(day+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===day?day:null;
}
export function sourceNotification(origin:SourceOrigin,row:any,today:string){
 if(!row||typeof row.id!=='string'||! /^[A-Za-z0-9_-]{1,80}$/.test(row.id))return null;
 const changed=row.updated_at||row.created_at;if(!alertDay(changed))return null;
 let title:string,status:string,dueAt:string|null=null,priority='NORMAL',description:string;
 if(origin==='ocr'){
  if(!['SUCCEEDED','FAILED','SUBMISSION_UNKNOWN'].includes(row.state))return null;
  const doc=Array.isArray(row.documents)?row.documents[0]:row.documents;
  if(!doc?.file_verified||doc.organization_id!==row.organization_id)return null;
  title=(row.state==='SUCCEEDED'?'OCR concluído: ':'OCR requer atenção: ')+(doc.original_filename||row.document_id);
  status=row.state;priority=row.state==='SUCCEEDED'?'NORMAL':'HIGH';
  description=row.state==='SUCCEEDED'?'A extração terminou. Confira os dados e o diagnóstico antes de validar; isto não comprova apuração aprovada.':'Confira o processamento do documento antes de tentar novamente. Nenhum resultado foi presumido.';
 }else{
  if(row.status!=='ACTIVE'||origin==='license'&&row.active!==true)return null;
  const end=alertDay(row.end_date);const renewal=origin==='license'&&!end?alertDay(row.renewal_date):null;
  const deadline=end||renewal;if(!deadline)return null;
  const delta=(Date.parse(deadline+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
  if(delta< -30||delta>30)return null;
  const kind=origin==='energy'?'Contrato de energia':origin==='management'?'Contrato de honorários':renewal?'Renovação da licença':'Licença';
  title=kind+(delta<0?' com prazo ultrapassado':delta===0?' com prazo hoje':' com prazo em '+delta+' dias')+(row.contract_number?' — '+row.contract_number:'');
  status=delta<0?'OVERDUE':'EXPIRING';priority=delta<=7?'HIGH':'NORMAL';dueAt=deadline+'T23:59:59-03:00';
  description=(renewal?'Data de renovação cadastrada: ':'Término de vigência cadastrado: ')+deadline+'. Confira o registro de origem; nenhuma renovação ou alteração contratual foi realizada.';
 }
 const fingerprint=createHash('sha256').update(JSON.stringify([row.id,row.state??row.status,status,priority,changed,row.end_date??null,row.renewal_date??null])).digest('hex');
 return {key:origin+':'+row.id+':'+fingerprint,id:row.id,title,description,status,priority,date:changed,dueAt,overdue:dueAt!==null&&alertDay(dueAt)!==null&&alertDay(dueAt)!<today,origin,read:false,href:origin==='ocr'?'/backoffice/documents':origin==='license'?'/backoffice/licenses':'/backoffice/contracts'};
}

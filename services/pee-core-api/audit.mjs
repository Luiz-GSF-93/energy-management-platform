const entities={company:'Empresa',unit:'Unidade consumidora',project:'Projeto',simulation:'Simulação',document:'Documento',rule:'Perfil do edital',workflow:'Etapa da CPP',communication:'Comunicação',royalty:'Royalty'};
const labels={
 'royalty.prepared':'Apuração de royalties preparada',
 'royalty.confirmed':'Apuração de royalties confirmada no Core',
 'license.cancellation_requested':'Cancelamento de licença solicitado',
 'project.emitted':'Relatório do projeto emitido',
 'communication.queued':'Comunicação aguardando envio',
 'communication.accepted':'Envio aceito pelo Resend',
 'communication.delivered':'Comunicação entregue',
 'communication.received':'Resposta recebida',
 'communication.failed':'Falha no envio da comunicação',
 'communication.bounced':'Comunicação devolvida pelo destinatário',
 'communication.complained':'Reclamação de comunicação registrada',
 'audit.exported':'Trilha de auditoria exportada',
 'eva.consulted':'Fontes oficiais consultadas na EVA',
 'document.downloaded':'Documento original baixado'
};
export function auditActionLabel(action){if(labels[action])return labels[action];const [kind,verb]=String(action).split('.');if(verb==='saved'&&entities[kind])return entities[kind]+(kind==='company'||kind==='unit'||kind==='simulation'||kind==='workflow'||kind==='communication'?' salva ou atualizada':' salvo ou atualizado');return 'Evento registrado · '+String(action).replace(/[._]/g,' ');}
export function enrichAudit(items,authors){const names=new Map(authors.map(a=>[a.id,a.name]));return items.map(e=>({...e,event_code:'EVT-'+String(e.id).padStart(6,'0'),action_label:auditActionLabel(e.action),record_code:e.record_code??'SEM-REGISTRO',author_name:names.get(e.actor_id)??'Nome não disponível',author_identified:names.has(e.actor_id)}));}
function csvCell(value){let s=String(value??'');if(/^[\s]*[=+@\-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
export function auditCsv(items){return ['Data e hora (Brasília);Ação;Código do registro;Registro;Autor;Evento;Ação original;ID original do registro;ID original do autor',...items.map(e=>[new Date(e.created_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}),e.action_label,e.record_code,e.record_name,e.author_name,e.event_code,e.action,e.record_id,e.actor_id].map(csvCell).join(';'))].join('\r\n')+'\r\n';}

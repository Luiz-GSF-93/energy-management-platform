'use client';
import {Button} from '@/app/components/ui/Button';
import type {InboxUpdate} from './assistant-inbox';
type Item={id:string;name:string;month:string;update?:InboxUpdate};
export default function AssistantInbox({items,onOpen,onRemove}:{items:Item[];onOpen:(id:string)=>void;onRemove:(id:string)=>void}){
 return <section className="ds-card" aria-label="Fila de validação bot-energy" style={{margin:'20px 0'}}>
  <h2>bot-energy · fila de validação</h2>
  <p>Novas faturas entram automaticamente. O bot prepara propostas sem gravar lançamentos ou aprovar valores. Você confere o PDF, valida os preenchimentos ou solicita revisão; a aprovação financeira é do gestor/administrador.</p>
  <p>As últimas 32 faturas acompanhadas são recuperadas nesta aba por até 24 horas. Ao voltar, as fontes e permissões são consultadas novamente.</p>
  {!items.length?<p>Nenhuma fatura acompanhada nesta aba. Envie uma nova fatura ou use “Adicionar à fila bot-energy” em um arquivo existente.</p>:<ul style={{listStyle:'none',padding:0}}>{items.map(item=><li key={item.id} style={{padding:16,borderBottom:'1px solid var(--color-border)'}}>
   <strong>{item.name} · {item.month}</strong>
   <p role="status">{item.update?.message??'Aguardando leitura OCR e conferência automática.'}</p>
   {item.update?.blockers!==undefined&&<p>{item.update.blockers} bloqueio(s) · {item.update.reviews} revisão(ões) · {item.update.fields} campo(s) a conferir · {item.update.proposals} lançamento(s) proposto(s). Proposta não é lançamento salvo.</p>}
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><Button type="button" variant="primary" disabled={!item.update||['WAITING','PREPARING'].includes(item.update.state)} onClick={()=>onOpen(item.id)}>Validar / revisar {item.name}</Button><Button type="button" variant="secondary" onClick={()=>onRemove(item.id)}>Retirar da fila {item.name}</Button></div>
  </li>)}</ul>}
 </section>;
}

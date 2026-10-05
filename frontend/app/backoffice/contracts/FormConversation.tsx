'use client';
import {useEffect, useRef, useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from '@/app/components/ui';
import {ConversationField, conversationValue} from './form-conversation';

type Props = {context: string; fields: ConversationField[]; disabled: boolean; reviewBeforeSave?:boolean; onApply: (field: ConversationField, value: string, evidence: string, persist: boolean) => Promise<string>};
export default function FormConversation({context, fields, disabled, onApply,reviewBeforeSave=false}: Props) {
  const [authorized, setAuthorized] = useState(false), [open, setOpen] = useState(false), [autoSave, setAutoSave] = useState(true);
  const [selected, setSelected] = useState(''), [reply, setReply] = useState(''), [evidence, setEvidence] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [messages, setMessages] = useState<string[]>([]), [skipped, setSkipped] = useState<string[]>([]);
  const lock = useRef(false), alive = useRef(true);
  const [reviewed,setReviewed]=useState<string[]>([]);
  useEffect(() => {alive.current = true; const abort = new AbortController(); apiRequest<{canAsk: boolean}>('/api/v1/documents/bot-energy/topics', {signal: abort.signal}).then(r => {if(alive.current)setAuthorized(r.canAsk);}).catch(() => {if(alive.current)setAuthorized(false);}); return () => {alive.current = false; abort.abort();};}, []);
  const pending = fields.filter(f => ((f.reviewRequired&&!reviewed.includes(f.key))||(f.promptWhenEmpty!==false&&!f.value?.trim())) && !skipped.includes(f.key));
  const field = fields.find(f => f.key === selected) ?? pending[0];
  async function respond(confirmValue=false) {
    if(!authorized || disabled || lock.current || !field) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const existing=field.value??'';
      const value = conversationValue(field, confirmValue?(field.kind==='decimal'?existing.replace('.',','):existing):reply);
      // The adapter receives the current field and uses existing authenticated write APIs.
      const result = await onApply(field, value, confirmValue?'OK do operador: valor sugerido conferido no documento. '+evidence.trim():evidence.trim(), !reviewBeforeSave&&autoSave);
      if(alive.current){setReviewed(r=>[...r,field.key]);setMessages(m => [...m, `${field.label}: ${value}. ${result}`]); setReply(''); setEvidence(''); setSelected(''); setSkipped(s => s.filter(k => k !== field.key));}
    } catch(e) {if(alive.current)setError(e instanceof Error ? e.message : 'A resposta não foi salva. Confira o formulário.');}
    finally {lock.current = false; if(alive.current)setBusy(false);}
  }
  if(!authorized) return null;
  return <section className="ds-card" aria-label="Bot-Energy · acompanhamento do preenchimento">
    <h3>Bot-Energy · preencher em conversa</h3><p>{context}</p>
    {!open ? <><p>Confira primeiro os dados preenchidos pela fatura e pelos cadastros vigentes. O bot solicita apenas os complementos pendentes; você também pode selecionar um campo para corrigir com justificativa. Validação e aprovação seguem as permissões do seu perfil.</p><Button type="button" disabled={disabled} onClick={() => setOpen(true)}>Iniciar preenchimento acompanhado</Button></> : <>
      {reviewBeforeSave?<p>As respostas completam o formulário. Confira os valores, marque “OK” e salve o rascunho ao concluir.</p>:<label><input type="checkbox" checked={autoSave} disabled={disabled || busy} onChange={e => setAutoSave(e.target.checked)}/> Salvar respostas automaticamente em rascunho</label>}
      <p>Dados informados pelo operador permanecem como informação humana para conferência; não se tornam evidência oficial ou confirmação OCR.</p>
      {messages.length > 0 && <details open><summary>Respostas aplicadas nesta conversa</summary><ul>{messages.map((m,i) => <li key={i}>{m}</li>)}</ul></details>}
      {error && <p role="alert">{error} Os campos permanecem disponíveis para correção; confira se a alteração ainda aguarda gravação.</p>}
      <label>Campo desta resposta<select className="ds-input" disabled={disabled || busy} value={field?.key ?? ''} onChange={e => {setSelected(e.target.value); setReply(''); setEvidence(''); setError('');}}><option value="">Selecione um campo</option>{fields.map(f => <option key={f.key} value={f.key}>{f.label}{f.value ? ' · preenchido' : ' · pendente'}</option>)}</select></label>
      {field ? <><p role="status"><strong>{field.question ?? `Qual é ${field.label}?`}</strong>{field.value && <> Valor atual: {field.value}. Esta resposta substituirá esse campo do rascunho.</>}</p>{field.choices && <p>Opções: {Object.entries(field.choices).map(([key,label]) => `${key}: ${label}`).join('; ')}.</p>}
        <label>Sua resposta ao dado solicitado<textarea className="ds-input" disabled={disabled || busy} maxLength={field.maxLength ?? 2000} rows={2} value={reply} onChange={e => setReply(e.target.value)} placeholder={field.kind === 'decimal' ? `Um único valor${field.unit ? ' em '+field.unit : ''}; exemplo: 194,8320` : field.kind === 'date' ? 'DD/MM/AAAA' : 'Informe o dado solicitado'}/></label>
        <label>Evidência ou justificativa desta resposta<textarea className="ds-input" disabled={disabled || busy} maxLength={300} rows={2} value={evidence} onChange={e => setEvidence(e.target.value)} placeholder="Documento, página ou justificativa da correção. Obrigatório para substituir valor existente."/></label>
        <Button type="button" disabled={disabled || busy || !reply.trim() || (!!field.value && !evidence.trim())} onClick={() => void respond()}>{busy ? 'Aplicando e conferindo…' : 'Responder e aplicar ao rascunho'}</Button>
        {field.reviewRequired&&field.value&&<Button type="button" disabled={disabled||busy} onClick={()=>void respond(true)}>OK — confirmar valor preenchido no documento</Button>}
        <Button type="button" variant="secondary" disabled={disabled || busy || !!field.required} onClick={() => {setSkipped(s => [...s,field.key]); setSelected(''); setReply(''); setEvidence('');}}>Preencher este dado depois</Button>
      </> : <p role="status">Não há outro campo vazio nesta etapa. Confira os dados e use a ação de revisão e validação do formulário. Dados adiados continuam pendentes.</p>}
      <Button type="button" variant="secondary" disabled={disabled || busy} onClick={() => setOpen(false)}>Pausar acompanhamento</Button>
    </>}
  </section>;
}

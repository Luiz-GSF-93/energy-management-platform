'use client';
import {Button,Input} from '@/app/components/ui';
export type CustomerContact={id:string;name:string;department:string;email:string;phone:string;active:boolean;channels:('email'|'whatsapp'|'sms')[]};
export default function CustomerContacts({value,onChange,disabled=false}:{value:CustomerContact[];onChange:(v:CustomerContact[])=>void;disabled?:boolean}){
 const update=(id:string,patch:Partial<CustomerContact>)=>onChange(value.map(c=>c.id===id?{...c,...patch}:c));
 return <fieldset disabled={disabled} style={{minWidth:0,border:'1px solid var(--border-color,#dce3eb)',borderRadius:12,padding:16,display:'grid',gap:16}}><legend>Contatos adicionais e departamentos</legend>
 <p>Selecione os canais autorizados para cada contato. O cadastro não envia mensagens nem concede acesso ao portal. Os destinatários e a recorrência serão definidos em Relatórios → Configurações.</p>
 {value.map((c,i)=><fieldset key={c.id} style={{minWidth:0,padding:12,borderRadius:8,display:'grid',gap:12}}><legend>Contato {i+1}</legend>
 <Input label="Nome do destinatário" value={c.name} required maxLength={150} onChange={e=>update(c.id,{name:e.target.value})}/>
 <Input label="Departamento" value={c.department} maxLength={100} onChange={e=>update(c.id,{department:e.target.value})}/>
 <Input label="E-mail do destinatário" type="email" value={c.email} required={c.channels.includes('email')} maxLength={254} onChange={e=>update(c.id,{email:e.target.value})}/>
 <Input label="Telefone internacional" placeholder="+5516999999999" value={c.phone} required={c.channels.some(x=>x!=='email')} maxLength={16} pattern="\+[1-9][0-9]{7,14}" onChange={e=>update(c.id,{phone:e.target.value})}/>
 <label><input type="checkbox" checked={c.active} onChange={e=>update(c.id,{active:e.target.checked})}/> Contato ativo</label>
 <div role="group" aria-label={'Canais autorizados do contato '+(i+1)}>{(['email','whatsapp','sms'] as const).map(channel=><label key={channel} style={{display:'inline-block',marginRight:16}}><input type="checkbox" checked={c.channels.includes(channel)} onChange={e=>update(c.id,{channels:e.target.checked?[...c.channels,channel]:c.channels.filter(x=>x!==channel)})}/> {channel==='email'?'E-mail':channel==='whatsapp'?'WhatsApp':'SMS'}</label>)}</div>
 <Button type="button" variant="secondary" onClick={()=>onChange(value.filter(x=>x.id!==c.id))}>Remover contato {i+1}</Button></fieldset>)}
 <Button type="button" variant="secondary" disabled={disabled||value.length>=50} onClick={()=>onChange([...value,{id:crypto.randomUUID(),name:'',department:'',email:'',phone:'',active:true,channels:[]}])}>Acrescentar contato</Button>
 <p>{value.length}/50 contatos adicionais. Alterações serão salvas com a justificativa e o histórico do cadastro.</p></fieldset>;
}

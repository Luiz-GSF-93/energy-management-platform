 'use client';
import {useEffect} from 'react';
import Link from 'next/link';
import OperationChoice from './OperationChoice';
export type CceeScope={customer:string;unit:string;month:string};
type Unit={id:string;customer_id:string;name?:string|null;customer_name?:string|null;consumer_unit_number?:string|null};
export default function CceeScopeBar({organizationId,actorId,units,value,onChange}:{organizationId:string;actorId?:string;units:Unit[];value:CceeScope;onChange:(v:CceeScope)=>void}){
 const key=actorId?'energyos:ccee-context:'+actorId+':'+organizationId:'';
 useEffect(()=>{try{const v=JSON.parse(key?sessionStorage.getItem(key)||'null':'null');if(v&&['customer','unit','month'].every(k=>typeof v[k]==='string'&&v[k].length<200)&&(!v.month||/^20\d{2}-\d{2}$/.test(v.month)))onChange(v);}catch{/* Only presentation filters, never permissions. */}},[key]);
 function change(v:CceeScope){onChange(v);try{if(key)sessionStorage.setItem(key,JSON.stringify(v));}catch{}}
 const companies=Array.from(new Map(units.map(u=>[u.customer_id,{value:u.customer_id,label:u.customer_name||'Cliente sem nome disponível'}])).values());
 const choices=Array.from(new Map(units.filter(u=>!value.customer||u.customer_id===value.customer).map(u=>[u.id,{value:u.id,label:(u.name||'Unidade sem nome')+(u.consumer_unit_number?' · UC '+u.consumer_unit_number:'')}])).values());
 return <section aria-label="Contexto de operação CCEE" style={{padding:16,border:'1px solid #55718a',borderRadius:12,margin:'16px 0'}}><h2>Empresa, unidade e competência</h2><div style={{display:'grid',gap:12,gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))'}}><OperationChoice label="Filtrar empresa CCEE" placeholder="Todas as empresas do recorte" value={value.customer} options={companies} onChange={customer=>change({...value,customer,unit:''})}/><OperationChoice label="Filtrar unidade CCEE" placeholder="Todas as unidades do recorte" value={value.unit} options={choices} onChange={unit=>change({...value,unit})}/><label>Competência<input aria-label="Competência do contexto CCEE" type="month" value={value.month} onChange={e=>change({...value,month:e.target.value})}/></label></div><p><button onClick={()=>change({customer:'',unit:'',month:''})}>Limpar filtros</button> · <Link href="/backoffice/ccee-registrations">Registros e contratos</Link> · <Link href="/backoffice/ccee-data">Dados, representação e calendário</Link> · <Link href="/backoffice/operation/agenda">Agenda operacional</Link></p><small>Filtros preservados nesta sessão por usuário e organização. Permissões e representação são conferidas pelo servidor.</small></section>;
}

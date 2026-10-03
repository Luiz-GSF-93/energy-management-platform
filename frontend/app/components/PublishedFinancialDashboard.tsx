'use client';
import {FormEvent,useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Button,Card} from '@/app/components/ui';

type Amounts={acr:string;aclBeforeFees:string;totalFees:string;aclAfterFees:string;savingsBeforeFees:string;savingsAfterFees:string;savingsPercent:string|null};
type Publication={id:string;customerId:string;customerName:string;month:string;version:number;payloadHash:string;publishedAt:string;publicationNote:string;units:{id:string;name:string}[];reservations:string[];amounts:Amounts};
type Data={organizationId:string;period:{from:string;to:string;customerId:string|null};updatedAt:string;publicationCount:number;customerCount:number;unitMonthCount:number;totals:Amounts|null;months:{month:string;publicationCount:number;totals:Amounts|null}[];rows:Publication[];disclosure:string};
type Filters={from:string;to:string;customerId:string};
const labels:Record<keyof Amounts,string>={acr:'Custo ACR',aclBeforeFees:'ACL antes dos honorários',totalFees:'Honorários',aclAfterFees:'ACL com honorários',savingsBeforeFees:'Economia antes dos honorários',savingsAfterFees:'Economia após honorários',savingsPercent:'Economia / ACR'};
// Exact decimal formatting only; all totals and percentages come from the backend.
export function financialDisplay(value:string|null,currency=true){
 if(value===null)return 'Não disponível';
 const [whole,fraction]=value.split('.');
 return (currency?'R$ ':'')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,'.')+','+fraction+(currency?'':'%');
}
export function publishedFinancialCsv(data:Data){
 const cell=(value:unknown)=>'"'+String(value??'').replace(/^[\s]*[=+@-]/,'\'$&').replace(/"/g,'""')+'"';
 const header=['Cliente','Competência','Versão','ACR (R$)','ACL antes honorários (R$)','Honorários (R$)','ACL com honorários (R$)','Economia após honorários (R$)','Ressalvas','Grupo publicado','Hash','Publicado em'];
 const numeric=(value:string)=>value.replace('.',',');
 return '\uFEFF'+[header.map(cell).join(';'),...data.rows.map(r=>[cell(r.customerName),cell(r.month),String(r.version),numeric(r.amounts.acr),numeric(r.amounts.aclBeforeFees),numeric(r.amounts.totalFees),numeric(r.amounts.aclAfterFees),numeric(r.amounts.savingsAfterFees),cell(r.reservations.join(' | ')),cell(r.id),cell(r.payloadHash),cell(r.publishedAt)].join(';'))].join('\r\n');
}
export default function PublishedFinancialDashboard({organizationId,organizationName}:{organizationId:string;organizationName:string}){
 const current=new Date(),initial={from:current.getFullYear()+'-01',to:current.getFullYear()+'-'+String(current.getMonth()+1).padStart(2,'0'),customerId:''};
 const [filters,setFilters]=useState<Filters>(initial),[request,setRequest]=useState({...initial,revision:0}),[data,setData]=useState<Data|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[customers,setCustomers]=useState<{id:string;name:string}[]>([]);
 useEffect(()=>{
  const abort=new AbortController();let cancelled=false;
  const query=new URLSearchParams({from:request.from,to:request.to});if(request.customerId)query.set('customerId',request.customerId);
  apiRequest<Data>('/api/v1/financial-settlements/published?'+query,{signal:abort.signal,cache:'no-store'}).then(result=>{
   if(result.organizationId!==organizationId||result.period.from!==request.from||result.period.to!==request.to||result.period.customerId!==(request.customerId||null))throw new Error('O escopo da consulta mudou. Atualize o painel.');
   if(!cancelled){setData(result);if(!request.customerId)setCustomers(Array.from(new Map(result.rows.map(r=>[r.customerId,{id:r.customerId,name:r.customerName}])).values()));}
  }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Não foi possível consultar as publicações.');}).finally(()=>{if(!cancelled)setLoading(false);});
  return()=>{cancelled=true;abort.abort();};
 },[organizationId,request]);
 const update=(key:keyof Filters,value:string)=>{setFilters(f=>({...f,[key]:value}));setData(null);setError('');};
 const consult=(e:FormEvent)=>{e.preventDefault();setData(null);setError('');setLoading(true);setRequest({...filters,revision:request.revision+1});};
 const download=()=>{if(!data?.rows.length)return;const url=URL.createObjectURL(new Blob([publishedFinancialCsv(data)],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=`EnergyOS-publicacoes-${data.period.from}-${data.period.to}.csv`;link.click();URL.revokeObjectURL(url);};
 return <section className="published-financial" aria-label="Financeiro publicado">
  <h2>Financeiro publicado</h2><p>Custos e economia das apurações aprovadas e publicadas. A confirmação do operador e as prévias não substituem a publicação pelo gestor.</p>
  <form onSubmit={consult} className="published-financial__filters">
   <label>De <input type="month" required disabled={loading} value={filters.from} max={filters.to} onChange={e=>update('from',e.target.value)}/></label>
   <label>Até <input type="month" required disabled={loading} value={filters.to} min={filters.from} onChange={e=>update('to',e.target.value)}/></label>
   <label>Cliente publicado <select disabled={loading} value={filters.customerId} onChange={e=>update('customerId',e.target.value)}><option value="">Todos os clientes publicados</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
   <Button type="submit" disabled={loading}>{loading?'Consultando…':'Consultar publicações'}</Button>
  </form>
  {error?<Alert variant="error">{error}</Alert>:null}{loading?<p role="status">Conferindo publicações e integridade das versões…</p>:null}
  {data&&!loading?<>
   <div className="published-financial__actions"><Button variant="secondary" disabled={!data.rows.length} onClick={()=>window.print()}>Imprimir / salvar PDF</Button><Button variant="secondary" disabled={!data.rows.length} onClick={download}>Exportar CSV para Excel</Button></div>
   <div className="published-financial__report">
    <h3>EnergyOS · Relatório financeiro publicado</h3><p>{organizationName} · {data.period.from} a {data.period.to}</p><p>Consulta em {new Date(data.updatedAt).toLocaleString('pt-BR')}. {data.publicationCount} publicações de cliente/mês; {data.customerCount} clientes; {data.unitMonthCount} unidades/mês.</p>
    <p>{data.disclosure}</p>
    {data.totals?<div className="published-financial__totals">{(Object.keys(labels) as (keyof Amounts)[]).map(key=><Card key={key} title={labels[key]}><strong>{financialDisplay(data.totals![key],key!=='savingsPercent')}</strong></Card>)}</div>:<Alert>Nenhuma apuração publicada neste período. Não há total financeiro disponível.</Alert>}
    <h4>Comparativo mensal</h4><div className="published-financial__table"><table><thead><tr><th>Competência</th><th>Publicações</th><th>ACR</th><th>ACL com honorários</th><th>Economia após honorários</th></tr></thead><tbody>{data.months.map(m=><tr key={m.month}><td>{m.month}</td><td>{m.publicationCount}</td><td>{m.totals?financialDisplay(m.totals.acr):'Sem publicação'}</td><td>{m.totals?financialDisplay(m.totals.aclAfterFees):'Não disponível'}</td><td>{m.totals?financialDisplay(m.totals.savingsAfterFees):'Não disponível'}</td></tr>)}</tbody></table></div>
    <h4>Publicações e ressalvas</h4>{data.rows.map(r=><article className="published-financial__publication" key={r.id}><h4>{r.customerName} · {r.month} · v{r.version} publicada</h4><p>Unidades: {r.units.map(u=>u.name||u.id).join(', ')}.</p><p>ACR {financialDisplay(r.amounts.acr)} · ACL com honorários {financialDisplay(r.amounts.aclAfterFees)} · economia {financialDisplay(r.amounts.savingsAfterFees)}.</p><p>Publicada em {new Date(r.publishedAt).toLocaleString('pt-BR')}. {r.publicationNote}</p><div><p><strong>Ressalvas e origem da versão</strong></p><ul>{r.reservations.map((note,i)=><li key={i}>{note}</li>)}</ul><p>Grupo: {r.id}<br/>Hash: <code>{r.payloadHash}</code></p></div></article>)}
    <p className="published-financial__signature">Powered by Expert Energy</p>
   </div>
  </>:null}
 </section>;
}

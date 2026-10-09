'use client';
import {useEffect,useRef,useState} from 'react';
import {MessageCircle,Send,BookOpen} from 'lucide-react';
import {useAuth} from '@/app/providers';
import {apiRequest} from '@/app/lib/api';
import {Alert,Button,Card} from '@/app/components/ui';
type BotReportResponse={state:string;answer?:string;message?:string;context?:{unitName:string;period:{from:string;to:string};kind:string};evidence?:{id:string;label:string;value:string;source:string}[]};
type Props={audience:'client'|'backoffice';reportId?:string;kind?:'OPERATIONAL'|'EXECUTIVE'|'FINANCIAL'};
export default function BotEnergyReports(props:Props){
 const {context,hasPermission}=useAuth(),org=context?.scope==='organization'?context.currentOrganization.id:'';
 const allowed=!!org&&hasPermission('62443ab1-9187-42e4-a932-a7cf54f76250')&&hasPermission('3ebadd32-6f30-459e-8ed3-0d2843d89946');
 return <BotEnergyReportsInner key={[org,context?.user.id,props.audience,props.reportId,props.kind,allowed].join('|')} {...props} org={org} allowed={allowed}/>;
}
function BotEnergyReportsInner({audience,reportId,kind:initialKind='OPERATIONAL',org,allowed}:Props&{org:string;allowed:boolean}){
 const now=new Date(),[from,setFrom]=useState(`${now.getFullYear()}-01`),[to,setTo]=useState(`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`),[unit,setUnit]=useState(''),[units,setUnits]=useState<{id:string;name:string}[]>([]),[kind,setKind]=useState(initialKind),[question,setQuestion]=useState(''),[result,setResult]=useState<BotReportResponse|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const epoch=useRef(0);
 const clearAnswer=()=>{epoch.current++;setResult(null);setBusy(false);setError('');};
 const changePeriod=(action:()=>void)=>{clearAnswer();setUnits([]);setUnit('');action();};
 useEffect(()=>{if(audience!=='client'||!allowed)return;let live=true;const epochRef=epoch,controller=new AbortController();apiRequest<{units:{id:string;name:string}[]}>('/api/v1/bot-energy/reports/client/units?'+new URLSearchParams({from,to}),{signal:controller.signal}).then(r=>{if(live){setUnits(r.units);if(r.units.length===1)setUnit(r.units[0].id);}}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;epochRef.current++;controller.abort();};},[org,allowed,audience,from,to]);
 useEffect(()=>{const epochRef=epoch;return()=>{epochRef.current++;};},[]);
 const ask=async()=>{const current=++epoch.current;setBusy(true);setError('');setResult(null);try{const body=audience==='client'?{question,unitId:unit,from,to,kind}:{question,reportId,kind};const r=await apiRequest<BotReportResponse>('/api/v1/bot-energy/reports/'+audience,{method:'POST',body});if(current===epoch.current)setResult(r);}catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:'Consulta indisponível.');}finally{if(current===epoch.current)setBusy(false);}};
 if(!allowed)return <Card title="Bot-Energy"><p>A consulta aos relatórios pelo Bot exige as permissões de relatórios e IA e uma licença vigente. Solicite a conferência à equipe de gestão.</p></Card>;
 return <Card title="Bot-Energy · entender meus resultados"><p><MessageCircle size={16}/> Pergunte sobre a unidade e o período selecionados. As respostas usam resultados publicados e fontes revisadas; a consulta não altera registros.</p>
 {audience==='client'?<div className="form-grid"><label>Unidade<select value={unit} disabled={busy} onChange={e=>{clearAnswer();setUnit(e.target.value);}}><option value="">Selecione</option>{units.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}</select></label><label>De<input type="month" value={from} disabled={busy} onChange={e=>changePeriod(()=>setFrom(e.target.value))}/></label><label>Até<input type="month" value={to} disabled={busy} onChange={e=>changePeriod(()=>setTo(e.target.value))}/></label><label>Visão<select value={kind} disabled={busy} onChange={e=>{clearAnswer();setKind(e.target.value as typeof kind);}}><option value="OPERATIONAL">Operacional</option><option value="EXECUTIVE">Executivo</option><option value="FINANCIAL">Financeiro</option></select></label></div>:null}
 <label>Pergunta<textarea value={question} maxLength={500} rows={3} disabled={busy} onChange={e=>setQuestion(e.target.value)} placeholder="Qual mês teve maior consumo? Como entender a economia publicada?"/></label><Button disabled={busy||!question.trim()||(audience==='client'?!unit:!reportId)} onClick={ask}><Send size={16}/> {busy?'Consultando fontes…':'Perguntar ao Bot'}</Button>
 {error?<Alert variant="error">{error}</Alert>:null}<div role="status" aria-live="polite">{result?<><p style={{whiteSpace:'pre-wrap'}}>{result.answer||result.message}</p>{result.context?<p>{result.context.unitName} · {result.context.period.from} a {result.context.period.to}</p>:null}{result.evidence?.length?<details><summary><BookOpen size={16}/> Fontes da resposta</summary>{result.evidence.map(e=><div key={e.id}><strong>{e.label}</strong><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{e.value}</p><small>{e.source}</small></div>)}</details>:null}</>:null}</div></Card>;
}

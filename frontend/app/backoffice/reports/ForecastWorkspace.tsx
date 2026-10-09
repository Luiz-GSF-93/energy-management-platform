'use client';

import {useEffect,useRef,useState} from 'react';

import {apiRequest} from '@/app/lib/api';

import {Button,Alert,Card} from '@/app/components/ui';

import FlowModal from '../acl-admissions/FlowModal';

import AnnualForecastPresentation,{type AnnualForecast} from './AnnualForecastPresentation';

import ForecastHistoryEditor,{type HistoryRow,type ForecastDocument} from './ForecastHistoryEditor';

import styles from './report-workspace.module.css';

import WeatherCyclePremises from './WeatherCyclePremises';

import ForecastHistoryReview from './ForecastHistoryReview';

type Expansion={description:string;startMonth:string;endMonth:string;monthlyKwh:string;justification:string};

const blankExpansion:Expansion={description:'',startMonth:'',endMonth:'',monthlyKwh:'',justification:''};

type Source={historyId?:string;evidenceId?:string;admissionId?:string;customerId:string;unitId:string;customerName:string;unitName:string;lastMonth:string};

type ForecastEvent={action:string};

type Run={id:string;customerName?:string;unitName?:string;cutoff:string;version:number;payload_hash:string;events:ForecastEvent[];body:AnnualForecast};

type History={id:string;document_id:string;reviewedAt:string|null;customerName:string;unitName:string;lastMonth:string;note:string;rows:HistoryRow[]};

const key=(s:Source)=>s.historyId??s.evidenceId??'';

export default function ForecastWorkspace({canCreate,customerId,unitId}:{canCreate:boolean;customerId:string;unitId:string}){

 const [loaded,setLoaded]=useState(false),[sources,setSources]=useState<Source[]>([]),[documents,setDocuments]=useState<ForecastDocument[]>([]),[histories,setHistories]=useState<History[]>([]),[runs,setRuns]=useState<Run[]>([]),[canApprove,setCanApprove]=useState(false);

 const [chosen,setChosen]=useState<string[]>([]),[cutoff,setCutoff]=useState(''),[expansions,setExpansions]=useState<Expansion[]>([]),[expansion,setExpansion]=useState<Expansion>({...blankExpansion}),[expansionOpen,setExpansionOpen]=useState(false);

 const [weather,setWeather]=useState(false),[latitude,setLatitude]=useState(''),[longitude,setLongitude]=useState(''),[consent,setConsent]=useState(false);

 const [sensitivity,setSensitivity]=useState<'LOW'|'UNKNOWN'>('UNKNOWN'),[climateNote,setClimateNote]=useState(''),[documentedPeriods,setDocumentedPeriods]=useState(false),[periods,setPeriods]=useState<Record<string,{previousReading:string;currentReading:string;page:string}>>({});

 const [selected,setSelected]=useState<Run|null>(null),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');

 const generation=useRef(0),request=useRef<string|null>(null),transitionRequests=useRef(new Map<string,string>());

 useEffect(()=>()=>{generation.current++;},[]);

 const reset=()=>{request.current=null;};

 const act=async(f:(n:number)=>Promise<void>)=>{const n=generation.current;setBusy(true);setError('');try{await f(n);}catch(e){if(n===generation.current)setError(e instanceof Error?e.message:'Consulta indisponível.');}finally{if(n===generation.current)setBusy(false);}};

 const refresh=async()=>{const n=generation.current;const q=new URLSearchParams({customerId,unitId});const result=await apiRequest<{canApprove:boolean;sources:Source[];documents:ForecastDocument[];histories:History[];runs:Run[]}>('/api/v1/energy-forecasts/workspace?'+q);if(n!==generation.current)return;setCanApprove(Boolean(result.canApprove)&&canCreate);setSources(result.sources);setDocuments(result.documents);setHistories(result.histories);setRuns(result.runs);setLoaded(true);};

 const first=sources.find(s=>key(s)===chosen[0]),available=first?sources.filter(s=>s.unitId===first.unitId&&s.customerId===first.customerId):sources;

 const periodRows=selected?.body.unitId===first?.unitId?selected?.body.actual:undefined;

 const datesComplete=Boolean(periodRows?.length&&periodRows.every(r=>periods[r.month]?.previousReading&&periods[r.month]?.currentReading&&Number(periods[r.month]?.page)>=1));

 const prepare=()=>act(async n=>{if(!first)return;request.current??=crypto.randomUUID();const r=await apiRequest<Run>('/api/v1/energy-forecasts',{method:'POST',body:{requestId:request.current,customerId:first.customerId,unitId:first.unitId,asOfMonth:cutoff,sources:sources.filter(s=>chosen.includes(key(s))).map(s=>s.historyId?{historyId:s.historyId}:{admissionId:s.admissionId,evidenceId:s.evidenceId}),expansions,...(weather?{weather:{latitude:Number(latitude.replace(',','.')),longitude:Number(longitude.replace(',','.')),consent,assessment:'ANNUAL_CYCLE_2',sensitivity,premiseNote:climateNote,...(documentedPeriods?{readingPeriods:periodRows?.map(r=>({month:r.month,evidenceId:r.evidence?.id,previousReading:periods[r.month]?.previousReading,currentReading:periods[r.month]?.currentReading,page:Number(periods[r.month]?.page)}))}:{})}}:{})}});if(n!==generation.current)return;setSelected({...r,customerName:first.customerName,unitName:first.unitName,events:r.events??[]});setNote('');reset();await refresh();});

 const transition=(r:Run,action:'VALIDATED'|'PUBLISHED')=>act(async n=>{const k=r.id+action+note;let id=transitionRequests.current.get(k);if(!id){id=crypto.randomUUID();transitionRequests.current.set(k,id);}const next=await apiRequest<Run>(`/api/v1/energy-forecasts/${r.id}/transitions`,{method:'POST',body:{requestId:id,payloadHash:r.payload_hash,action,note}});if(n!==generation.current)return;setSelected(next);setNote('');await refresh();});

 const approve=(id:string)=>act(async n=>{const k=id+note;let req=transitionRequests.current.get(k);if(!req){req=crypto.randomUUID();transitionRequests.current.set(k,req);}await apiRequest(`/api/v1/energy-forecasts/histories/${id}/validate`,{method:'POST',body:{requestId:req,note}});if(n===generation.current){setNote('');await refresh();}});

 const open=(id:string)=>act(async n=>{const r=await apiRequest<Run>('/api/v1/energy-forecasts/'+id);if(n===generation.current){setSelected(r);setNote('');}});

 return <Card title="Previsão de consumo"><details><summary>Preparar e validar a projeção anual</summary><p>Reúna de 12 a 36 competências consecutivas de faturas conferidas. A Adesão ACL é uma fonte opcional. A previsão publicada será incluída nas novas versões operacionais com a mesma unidade e competência de corte.</p><Button variant="secondary" disabled={busy} onClick={()=>void act(()=>refresh())}>{loaded?'Atualizar históricos e previsões':'Consultar históricos e previsões'}</Button>{busy?<p role="status">Consultando…</p>:null}{error?<Alert variant="error">{error}</Alert>:null}

 {loaded?<><fieldset disabled={busy}><legend>Fontes validadas</legend>{available.length?available.map(s=><label key={key(s)}><input type="checkbox" checked={chosen.includes(key(s))} onChange={e=>{reset();if(e.target.checked){setChosen(a=>[...a,key(s)]);if(!cutoff)setCutoff(s.lastMonth);}else setChosen(a=>a.filter(v=>v!==key(s)));}}/>{s.customerName} · {s.unitName} · até {s.lastMonth} · {s.historyId?'Fatura cadastrada':'Adesão ACL'}</label>):<p>Nenhum histórico validado disponível. Confira uma fatura abaixo para preparar o histórico.</p>}{chosen.length?<Button variant="secondary" onClick={()=>{reset();setChosen([]);setCutoff('');setExpansions([]);setSelected(null);setWeather(false);setConsent(false);setLatitude('');setLongitude('');setSensitivity('UNKNOWN');setClimateNote('');setDocumentedPeriods(false);setPeriods({});}}>Limpar fontes selecionadas</Button>:null}<label>Competência de corte<input type="month" value={cutoff} onChange={e=>{reset();setCutoff(e.target.value);}}/></label></fieldset>

 {canCreate?<><Button variant="secondary" disabled={busy||expansions.length>=20} onClick={()=>{setExpansion({...blankExpansion});setExpansionOpen(true);}}>Adicionar expansão de carga</Button>{expansions.map((e,i)=><p key={i}>{e.description} · {e.monthlyKwh} kWh/mês · {e.startMonth} a {e.endMonth} <Button variant="secondary" disabled={busy} onClick={()=>{reset();setExpansions(a=>a.filter((_,n)=>n!==i));}}>Remover expansão</Button></p>)}

 <fieldset disabled={busy}><legend>Temperatura regional</legend><label><input type="checkbox" checked={weather} onChange={e=>{reset();setWeather(e.target.checked);setConsent(false);}}/>Consultar histórico NASA POWER</label>{weather?<><div className="form-grid"><label>Latitude regional<input inputMode="decimal" value={latitude} onChange={e=>{reset();setLatitude(e.target.value);setConsent(false);}}/></label><label>Longitude regional<input inputMode="decimal" value={longitude} onChange={e=>{reset();setLongitude(e.target.value);setConsent(false);}}/></label></div><p>A consulta envia as coordenadas e o período à NASA POWER. Use um ponto de referência regional, compatível com a resolução aproximada de 50 km.</p><label><input type="checkbox" checked={consent} onChange={e=>{reset();setConsent(e.target.checked);}}/>Autorizo consultar a localização informada na NASA POWER.</label><WeatherCyclePremises sensitivity={sensitivity} setSensitivity={setSensitivity} note={climateNote} setNote={setClimateNote} documented={documentedPeriods} setDocumented={setDocumentedPeriods} periods={periods} setPeriods={setPeriods} rows={periodRows} reset={reset}/></>:null}</fieldset><Button disabled={busy||!chosen.length||!cutoff||(weather&&(!latitude||!longitude||!consent||climateNote.trim().length<20||(documentedPeriods&&!datesComplete)))} onClick={()=>void prepare()}>Calcular previsão para validação</Button><ForecastHistoryEditor documents={documents} onSaved={refresh}/></>:null}

 <label>Justificativa de validação ou publicação<textarea disabled={busy} value={note} minLength={20} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label>

 <details><summary>Históricos aguardando validação ({histories.filter(h=>!h.reviewedAt).length})</summary>{histories.filter(h=>!h.reviewedAt).map(h=><div key={h.id}><h4>{h.customerName} · {h.unitName}</h4><p>Última competência: {h.lastMonth} · {h.note}</p><ForecastHistoryReview documentId={h.document_id}/><table className={styles.table}><thead><tr><th>Mês</th><th>Consumo kWh</th><th>Dias</th><th>Página</th><th>Fonte</th></tr></thead><tbody>{h.rows.map((r)=><tr key={r.month}><td>{r.month}</td><td>{r.consumptionKwh}</td><td>{r.days}</td><td>{r.page}</td><td>{r.source}</td></tr>)}</tbody></table><Button disabled={busy||!canApprove||note.trim().length<20} onClick={()=>void approve(h.id)}>Validar histórico conferido</Button></div>)}</details>

 <h3>Versões da previsão</h3>{!runs.length?<p>Nenhuma previsão registrada.</p>:runs.map(r=><p key={r.id}>Corte {r.cutoff} · v{r.version} · {r.events.some((e)=>e.action==='PUBLISHED')?'Publicada':r.events.some((e)=>e.action==='VALIDATED')?'Validada':'Para validação'} <Button variant="secondary" disabled={busy} onClick={()=>void open(r.id)}>Conferir versão</Button></p>)}

 {selected?<><h3>{selected.customerName??"Cliente"} · {selected.unitName??"Unidade"}</h3><AnnualForecastPresentation forecast={{...selected.body,id:selected.id,version:selected.version,payloadHash:selected.payload_hash}} preliminary={!selected.events?.some((e)=>e.action==='PUBLISHED')}/>{selected.events?.some((e)=>e.action==='PUBLISHED')?<p>Versão publicada. Gere uma nova versão operacional para incorporar esta previsão; os relatórios anteriores permanecem preservados.</p>:<Button disabled={busy||!canApprove||note.trim().length<20} onClick={()=>void transition(selected,selected.events?.some((e)=>e.action==='VALIDATED')?'PUBLISHED':'VALIDATED')}>{selected.events?.some((e)=>e.action==='VALIDATED')?'Publicar previsão validada':'Validar previsão e premissas'}</Button>}</>:null}</>:null}</details>

 <FlowModal open={expansionOpen} title="Premissa de expansão de carga" onClose={()=>setExpansionOpen(false)}><div className={styles.workspace}><p>Registre o consumo adicional mensal documentado. A premissa será conferida junto à previsão; não altera o consumo histórico ou a apuração financeira.</p><label>Descrição<input maxLength={160} value={expansion.description} onChange={e=>setExpansion({...expansion,description:e.target.value})}/></label><div className="form-grid"><label>Início<input type="month" value={expansion.startMonth} onChange={e=>setExpansion({...expansion,startMonth:e.target.value})}/></label><label>Fim<input type="month" value={expansion.endMonth} onChange={e=>setExpansion({...expansion,endMonth:e.target.value})}/></label><label>Consumo adicional por mês (kWh)<input inputMode="decimal" value={expansion.monthlyKwh} onChange={e=>setExpansion({...expansion,monthlyKwh:e.target.value.replace(',','.')})}/></label></div><label>Justificativa e referência documental<textarea maxLength={1000} value={expansion.justification} onChange={e=>setExpansion({...expansion,justification:e.target.value})}/></label><Button disabled={expansion.description.trim().length<3||!cutoff||expansion.startMonth<=cutoff||expansion.endMonth<expansion.startMonth||!/^\d+(\.\d{1,6})?$/.test(expansion.monthlyKwh)||expansion.justification.trim().length<20} onClick={()=>{reset();setExpansions(a=>[...a,expansion]);setExpansionOpen(false);}}>Adicionar premissa para revisão</Button></div></FlowModal></Card>;

}

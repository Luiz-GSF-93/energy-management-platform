'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useAuth} from '@/app/providers';
import {session} from '@/app/lib/auth/session';
import {apiRequest} from '@/app/lib/api/client';
import {Button} from './ui';
import styles from './CceeTraining.module.css';
type Content={id:string;title:string;version:string;duration:number;mandatory:boolean;chapters:{start:number;title:string}[]};
type State={eligible:boolean;organizationId?:string;content?:Content;progress?:{position:number;percent:number;completedAt:string|null;revision:number}};
type Media={contentId:string;expiresAt:string;urls:Record<string,string>};
const endpoint='/api/v1/training/ccee';
function loginMarker(user:string,org:string){let sid='';try{sid=String(JSON.parse(atob((session.getAccessToken()||'').split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).session_id||'');}catch{/* Server authorization remains authoritative. */}return sid?'energyos:training:'+user+':'+org+':'+sid:null;}
export default function CceeTraining(){const {context,status}=useAuth();
 useEffect(()=>{const clear=()=>{for(const key of Object.keys(sessionStorage))if(key.startsWith('energyos:training:'))sessionStorage.removeItem(key);};window.addEventListener('session-ended',clear);return()=>window.removeEventListener('session-ended',clear);},[]);
 const internal=status==='authenticated'&&context?.scope==='organization'&&!context.accessMode&&['admin_org','gestor','operacional'].includes(context.currentOrganization.role);
 const org=internal?context.currentOrganization.id:'',user=internal?context.user.id:'';
 return internal?<TrainingWorkspace key={user+':'+org} org={org} user={user}/>:null;
}
function TrainingWorkspace({org,user}:{org:string;user:string}){
 const [state,setState]=useState<State|null>(null),[open,setOpen]=useState(false),[media,setMedia]=useState<Media|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),video=useRef<HTMLVideoElement>(null),player=useRef<string|null>(null),chain=useRef<Promise<unknown>>(Promise.resolve()),live=useRef(true),content=useRef<Content|null>(null),seek=useRef(false);
 useEffect(()=>{live.current=true;let active=true;apiRequest<State>(endpoint,{cache:'no-store'}).then(s=>{if(!active||!s.eligible||s.organizationId!==org)return;setState(s);content.current=s.content??null;const key=loginMarker(user,org);if(s.content?.mandatory&&!s.progress?.completedAt&&key&&!sessionStorage.getItem(key)){sessionStorage.setItem(key,'presented');setOpen(true);}}).catch(()=>{/* A training lookup never replaces the business workspace with an error. Retry remains available through navigation. */});return()=>{active=false;live.current=false;};},[org,user]);
 useEffect(()=>{if(open)dialog.current?.showModal();else dialog.current?.close();},[open]);
 const command=useCallback((action:string,position=video.current?.currentTime??0,playing=!!video.current&&!video.current.paused,visible=document.visibilityState==='visible')=>{
  const c=content.current,pid=player.current;if(!c||action!=='DEFER'&&!pid)return Promise.resolve(null);
  const work=chain.current.catch(()=>undefined).then(()=>apiRequest<State>(endpoint+'/progress',{method:'POST',body:{contentId:c.id,action,...(action==='DEFER'?{}:{playerId:pid}),position,playing,visible}})).then(s=>{if(live.current&&s?.eligible&&s.organizationId===org)setState(s);return s;});
  chain.current=work;return work.catch(e=>{if(live.current)setError(e instanceof Error?e.message:'Progresso não confirmado.');return null;});
 },[org]);
 useEffect(()=>{if(!media)return;const id=window.setInterval(()=>{if(video.current&&!video.current.paused&&!seek.current&&document.visibilityState==='visible')void command('TICK');},10000);
  const hide=()=>{if(document.visibilityState!=='visible'){void command('TICK',video.current?.currentTime??0,false,true);video.current?.pause();}};
  document.addEventListener('visibilitychange',hide);return()=>{window.clearInterval(id);document.removeEventListener('visibilitychange',hide);};},[media,command]);
 useEffect(()=>()=>{if(player.current)void command('RELEASE',video.current?.currentTime??0,false,false);},[command]);
 async function watch(){const c=state?.content;if(!c)return;setBusy(true);setError('');try{
  const m=await apiRequest<Media>(endpoint+'/media',{method:'POST',body:{contentId:c.id}});if(!live.current||m.contentId!==c.id)return;
  player.current=crypto.randomUUID();const ack=await command('OPEN',state?.progress?.position??0,false,true);if(!ack){player.current=null;return;}setMedia(m);
 }catch(e){if(live.current)setError(e instanceof Error?e.message:'Não foi possível abrir o treinamento.');}finally{if(live.current)setBusy(false);}}
 async function later(){setBusy(true);video.current?.pause();if(player.current)await command('RELEASE',video.current?.currentTime??0,false,true);player.current=null;await command('DEFER',0,false,true);setMedia(null);setBusy(false);setOpen(false);}
 async function closePlayer(){video.current?.pause();if(player.current)await command('RELEASE',video.current?.currentTime??0,false,true);player.current=null;setMedia(null);setOpen(false);}
 if(!state?.eligible||!state.content)return null;
 const c=state.content,p=state.progress,done=!!p?.completedAt;
 return <><Button variant="secondary" onClick={()=>{setError('');setOpen(true);}}>Treinamento CCEE{done?' · concluído':` · ${p?.percent??0}%`}</Button>
 <dialog className={styles.dialog} ref={dialog} onCancel={e=>{e.preventDefault();void later();}} aria-labelledby="ccee-training-heading">
  <header className={styles.header}><div><p className={styles.eyebrow}>EnergyOS Academy · versão {c.version}</p><h2 id="ccee-training-heading">{c.title}</h2></div><Button variant="secondary" disabled={busy} onClick={()=>void closePlayer()}>Fechar</Button></header>
  <p>Agenda, registros e fechamento pela EVA até a publicação no portal do cliente. Demonstração com dados fictícios.</p>
  <p role="status">{done?'Treinamento concluído. Este aviso não voltará a aparecer nos próximos logins.':`Treinamento obrigatório · ${p?.percent??0}% assistido. Você pode ver depois e retomar do ponto salvo.`}</p>
  {error?<p className={styles.error} role="alert">{error} O último progresso confirmado foi preservado.</p>:null}
  {media?<>
   <video className={styles.video} ref={video} controls playsInline crossOrigin="anonymous" preload="metadata" poster={media.urls['poster.png']}
    onLoadedMetadata={()=>{if(video.current)video.current.currentTime=Math.min(p?.position??0,Math.max(0,video.current.duration-0.2));}}
    onPlay={()=>void command('TICK',video.current?.currentTime??0,true)} onPause={()=>void command('TICK',video.current?.currentTime??0,false)}
    onSeeking={()=>{seek.current=true;void command('TICK',video.current?.currentTime??0,false,false);}}
    onSeeked={()=>{seek.current=false;void command('TICK',video.current?.currentTime??0,!!video.current&&!video.current.paused);}}
    onEnded={()=>void command('TICK',video.current?.currentTime??0,false)} onRateChange={()=>{if(video.current&&video.current.playbackRate>2)video.current.playbackRate=2;}}
    onError={()=>setError('Não foi possível reproduzir a mídia. Feche e abra o treinamento para renovar o acesso temporário.')}>
    <source src={media.urls['video.mp4']} type="video/mp4"/><track default kind="subtitles" src={media.urls['legendas.vtt']} srcLang="pt-BR" label="Português"/>
   </video>
   <progress className={styles.progress} max={100} value={p?.percent??0} aria-label="Progresso confirmado do treinamento"/>
   <details><summary>Capítulos e materiais de consulta</summary><nav className={styles.chapters} aria-label="Capítulos do treinamento">{c.chapters.map((ch,i)=><button key={i} onClick={()=>{if(video.current)video.current.currentTime=ch.start;}}>{ch.title}</button>)}</nav><p>Pular um capítulo não o marca como assistido. Retorne aos trechos pendentes para concluir.</p><p><a href={media.urls['guia.pdf']} target="_blank" rel="noopener noreferrer">Guia visual e checklist</a> · <a href={media.urls['transcricao.txt']} target="_blank" rel="noopener noreferrer">Transcrição</a></p></details>
  </>:<div className={styles.intro}><p>Você verá a fatura e as notas fiscais de exemplo, os campos preenchidos pela EVA, a revisão pelo perfil autorizado e os resultados publicados no portal.</p><p>A reprodução fica registrada somente para seu usuário nesta organização. Assistir não concede permissões nem executa operações financeiras ou CCEE.</p><Button disabled={busy} onClick={()=>void watch()}>{busy?'Preparando vídeo…':done?'Assistir novamente':'Assistir agora'}</Button></div>}
  <footer className={styles.footer}><span>{done?'Disponível para consulta sempre que precisar.':'O lembrete reaparece no próximo login até a conclusão da versão obrigatória.'}</span><Button variant="secondary" disabled={busy} onClick={()=>void later()}>{done?'Fechar':'Ver depois'}</Button></footer>
 </dialog></>;
}

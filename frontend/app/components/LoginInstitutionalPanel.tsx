'use client';
import {useEffect,useRef,useState} from 'react';
import './LoginHero.css';
import {loginText,type LoginLanguage} from './login-language';

/** Illustrative local content only: no tenant APIs, financial values, OCR or AI calls. */
export const LOGIN_HERO_INTERVAL_MS=6000;
type Slide={id:string;label:string;title:string;description:string;view:'chart'|'document'|'checks'|'flow';tags:readonly string[]};
const slides:readonly Slide[]=[
 {id:'dashboard',label:'Dashboard energético',title:'Uma visão conectada da operação.',description:'Consumo, contratos e cenários reunidos para apoiar a consultoria e a gestão energética.',view:'chart',tags:['Consumo','Contratos','Cenários']},
 {id:'eva',label:'EVA · análise de documentos',title:'Do documento à informação conferida.',description:'Leitura assistida de faturas, notas e contratos, com evidências preservadas e conferência humana.',view:'document',tags:['Leitura','Extração','Conferência']},
 {id:'compliance',label:'Controle de compliance',title:'Pontos de atenção em contexto.',description:'Organize cláusulas, garantias e pendências documentais para orientar uma revisão criteriosa.',view:'checks',tags:['Garantias','Cláusulas','Evidências']},
 {id:'governance',label:'Governança',title:'Cada decisão com seu histórico.',description:'Perfis, etapas e responsabilidades para separar o preenchimento, a conferência e a aprovação.',view:'flow',tags:['Permissões','Rastreabilidade','Aprovação']},
 {id:'regulatory',label:'Auditoria regulatória',title:'Análises apoiadas em fontes oficiais.',description:'Documentos e referências do setor elétrico no contexto da avaliação, com ressalvas e fontes para conferência.',view:'checks',tags:['Fontes oficiais','Vigências','Relatório']},
 {id:'strategy',label:'Consultoria estratégica',title:'Mais contexto para planejar energia.',description:'Compare cenários e condições comerciais para apoiar a estratégia energética de empresas e unidades.',view:'chart',tags:['Mercado Livre','Comparativos','Planejamento']}
];

function DemoScreen({slide,language}:{slide:Slide;language:LoginLanguage}){
 const t=(text:string)=>loginText(language,text);
 return <div className="login-hero-stage" aria-hidden="true">
  <div className="login-hero-window">
   <div className="login-hero-window__bar"><span className="login-hero-window__dots">● ● ●</span><strong>Energy<span>OS</span></strong><span>{t('Visão ilustrativa')}</span></div>
   <div className="login-hero-window__workspace">
    <div className="login-hero-window__rail"><b>E</b><span>▦</span><span>▤</span><span>◇</span><span>✓</span></div>
    <div className="login-hero-window__main"><div className="login-hero-window__heading"><span>{slide.label}</span><span className="login-hero-chip">EVA</span></div>
     <div className="login-hero-kpis">{slide.tags.map((tag,i)=><div key={tag}><small>0{i+1}</small><strong>{tag}</strong><span className="login-hero-kpis__line"/></div>)}</div>
     {slide.view==='chart'?<div className="login-hero-chart"><div className="login-hero-chart__legend"><span>{t('Referência')}</span><span>{t('Cenário em análise')}</span></div><div className="login-hero-chart__bars">{['JAN','FEV','MAR','ABR','MAI','JUN'].map(month=><div key={month}><span/><span/><small>{t(month)}</small></div>)}</div></div>:
      slide.view==='document'?<div className="login-hero-document"><div className="login-hero-document__paper"><strong>{t('Contrato de energia')}</strong><i/><i/><p>{t('Garantias e condições de fornecimento')}</p><i/><i/></div><div className="login-hero-document__findings"><b>{t('EVA · pontos de atenção')}</b><span>✓ {t('Original preservado')}</span><span>◇ {t('Cláusulas em revisão')}</span><span>↗ {t('Fontes para conferência')}</span></div></div>:
      slide.view==='flow'?<div className="login-hero-flow">{['Documento recebido','Conferência do operador','Aprovação do responsável','Publicação autorizada'].map((label,i)=><div key={label}><b>{i<2?'✓':String(i+1).padStart(2,'0')}</b><span>{t(label)}</span><small>{t(i<2?'Conferido':'Próxima etapa')}</small></div>)}</div>:
      <div className="login-hero-checks">{(slide.id==='regulatory'?['Referências oficiais','Vigência das fontes','Evidências do documento']:['Garantias contratuais','Cessão e obrigações','Cláusulas para revisão']).map((label,i)=><div key={label}><span>{i===2?'◇':'✓'}</span><b>{t(label)}</b><small>{t(i===2?'Conferir':'Referenciado')}</small></div>)}<p>{t('Relatório de conformidade · fontes e considerações')}</p></div>}
    </div>
   </div>
  </div>
  <div className="login-hero-float"><span>✦</span><div><strong>EVA</strong><small>{t('Informação para a sua decisão')}</small></div></div>
 </div>;
}

export default function LoginInstitutionalPanel({language='pt'}:{language?:LoginLanguage}={}){
 const t=(text:string)=>loginText(language,text);
 const[index,setIndex]=useState(0),[paused,setPaused]=useState(false),[hovered,setHovered]=useState(false),[focused,setFocused]=useState(false),[visible,setVisible]=useState(false),[inView,setInView]=useState(false),[reduced,setReduced]=useState(true);
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{
  const media=typeof window.matchMedia==='function'?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
  const motion=()=>setReduced(media?.matches??false),visibility=()=>setVisible(document.visibilityState==='visible');motion();visibility();
  media?.addEventListener('change',motion);document.addEventListener('visibilitychange',visibility);
  const observer=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>setInView(entries.some(e=>e.isIntersecting)),{threshold:.15}):null;
  if(observer&&panel.current)observer.observe(panel.current);else setInView(true);
  return()=>{media?.removeEventListener('change',motion);document.removeEventListener('visibilitychange',visibility);observer?.disconnect();};
 },[]);
 useEffect(()=>{
  if(paused||hovered||focused||!visible||!inView||reduced)return;
  const timer=window.setInterval(()=>setIndex(i=>(i+1)%slides.length),LOGIN_HERO_INTERVAL_MS);
  return()=>window.clearInterval(timer);
 },[index,paused,hovered,focused,visible,inView,reduced]);
 const originalSlide=slides[index],slide={...originalSlide,label:t(originalSlide.label),title:t(originalSlide.title),description:t(originalSlide.description),tags:originalSlide.tags.map(t)};
 return <aside ref={panel} className="login-institutional" aria-labelledby="login-institutional-title" onPointerEnter={()=>setHovered(true)} onPointerLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFocused(false);}}>
  <div className="login-institutional__glow" aria-hidden="true"/>
  <span className="login-institutional__eyebrow">{t('CONSULTORIA · ESTRATÉGIA · GESTÃO')}</span>
  <h2 id="login-institutional-title">{t('Inteligência para sua')}<br/><em>{t('gestão de energia.')}</em></h2>
  <section className="login-hero" aria-roledescription="carrossel" aria-label={t('Recursos do EnergyOS')}>
   <div className="login-hero-slide" key={slide.id} aria-roledescription="slide" aria-label={`${index+1} ${t('de')} ${slides.length}`}>
    <DemoScreen slide={slide} language={language}/>
    <div className="login-hero-caption"><span>{slide.label}</span><h3>{slide.title}</h3><p>{slide.description}</p></div>
   </div>
   <div className="login-hero-controls"><button type="button" aria-label={t('Módulo anterior')} onClick={()=>setIndex(i=>(i+slides.length-1)%slides.length)}>←</button><div className="login-hero-dots">{slides.map((item,i)=><button type="button" key={item.id} aria-label={`${t('Ver')} ${t(item.label)}`} aria-current={i===index?'true':undefined} onClick={()=>setIndex(i)}><span/></button>)}</div><button type="button" aria-label={t('Próximo módulo')} onClick={()=>setIndex(i=>(i+1)%slides.length)}>→</button><button type="button" className="login-hero-pause" aria-pressed={paused} disabled={reduced} onClick={()=>setPaused(p=>!p)}>{t(reduced?'Manual':paused?'Reproduzir':'Pausar')}</button></div>
  </section>
  <p className="login-institutional__privacy">{t('Simulação visual dos recursos, sem dados reais.')} {t(reduced?'Movimento reduzido: use os controles para navegar.':'Troca automática a cada 6 segundos; pausa ao interagir com o banner.')}</p>
  <a className="login-institutional__link" href="https://www.energy-os.app.br/" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">{t('Conheça o EnergyOS')} ↗</a>
 </aside>;
}

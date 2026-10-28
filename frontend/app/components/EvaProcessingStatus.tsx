'use client';
import BotEnergyAvatar from './BotEnergyAvatar';

/** Presentation only: callers supply their actual in-flight state. */
export default function EvaProcessingStatus({detail='A EVA está conferindo as informações do documento.'}:{detail?:string}){
 return <div role="status" aria-live="polite" aria-atomic="true" aria-label="EVA validando" style={{display:'flex',alignItems:'center',gap:16,padding:16,margin:'12px 0',border:'1px solid #405873',borderRadius:12,background:'#0c253d',color:'#e8f7ff',minHeight:88}}>
  <BotEnergyAvatar size={64}/><div style={{minWidth:0,overflowWrap:'anywhere'}}><strong style={{display:'block',color:'#67e8f9',fontSize:16}}>Validando, aguarde…</strong><p style={{margin:'6px 0 0',lineHeight:1.5}}>{detail}</p></div>
 </div>;
}

'use client';
import {useEffect,useRef} from 'react';
import {botGuidance} from './bot-guidance';
export default function BotEnergyGuidance({error}:{error:string}){
 const target=useRef<HTMLElement>(null);
 useEffect(()=>{if(error)target.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});},[error]);
 return <aside ref={target} role="alert" aria-label="bot-energy · orientação da operação" className="ds-card" style={{borderColor:'#54c5df'}}><strong>⚡ bot-energy · vamos revisar este lançamento</strong><p>{error}</p><ol>{botGuidance(error).map(step=><li key={step}>{step}</li>)}</ol><small>Orientação baseada no erro retornado. Não altera valores, confirma documentos nem aprova financeiramente.</small></aside>;
}

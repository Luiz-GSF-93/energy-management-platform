'use client';
import {useEffect,useRef} from 'react';
/** Announce a server-confirmed result where the operator can see it after closing the editor. */
export default function ConfigurationSuccess({message}:{message:string}){
 const target=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(message){target.current?.focus({preventScroll:true});target.current?.scrollIntoView?.({block:'nearest',behavior:'smooth'});}},[message]);
 return <div ref={target} tabIndex={-1} role="status" aria-live="polite" className="ds-card" style={{borderColor:'var(--color-primary, #54c6df)'}}><strong>⚡ bot-energy · resultado da operação</strong><p>{message}</p><p>O diagnóstico reconhece somente a revisão atual. Salvar um rascunho ou manter pendente não conclui a apuração.</p></div>;
}

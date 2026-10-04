'use client';
import {ReactNode,useEffect,useRef} from 'react';
export default function DocumentDialog({label,onClose,busy=false,children}:{label:string;onClose:()=>void;busy?:boolean;children:ReactNode}){
 const panel=useRef<HTMLElement>(null);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;panel.current?.querySelector<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')?.focus();return()=>previous?.focus();},[]);
 return <div className="document-manager__overlay"><section ref={panel} role="dialog" aria-modal="true" aria-label={label} className="document-manager__dialog" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();onClose();}if(e.key==='Tab'){const fields=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')).filter(v=>v.getClientRects().length);if(!fields.length){e.preventDefault();return;}if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0].focus();}}}}>{children}</section></div>;
}

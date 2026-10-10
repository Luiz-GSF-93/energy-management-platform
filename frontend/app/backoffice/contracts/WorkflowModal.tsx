'use client';
import {Button} from '@/app/components/ui';
import {useEffect,useRef,type ReactNode} from 'react';
export default function WorkflowModal({title,onClose,children}:{title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const d=ref.current;const previous=document.activeElement as HTMLElement|null;d?.showModal();return()=>{d?.close();previous?.focus();};},[]);
 return <dialog ref={ref} aria-label={title} onCancel={e=>{e.preventDefault();onClose();}} style={{width:'min(1180px,94vw)',maxWidth:'94vw',height:'90vh',maxHeight:'90vh',padding:0,border:'1px solid #405571',borderRadius:16,background:'#101b2c',color:'#eff6ff'}}><header style={{position:'sticky',top:0,zIndex:4,background:'#101b2c',borderBottom:'1px solid #405571',padding:'16px 22px',display:'flex',justifyContent:'space-between',gap:20,alignItems:'center'}}><h2 style={{margin:0,fontSize:20}}>{title}</h2><Button variant="secondary" onClick={onClose} aria-label={'Fechar '+title}>Fechar</Button></header><div style={{padding:'20px clamp(12px,3vw,30px)'}}>{children}</div></dialog>;
}

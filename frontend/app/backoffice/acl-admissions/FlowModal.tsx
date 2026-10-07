'use client';
import {ReactNode,useEffect,useId,useRef} from 'react';
import {Button} from '@/app/components/ui';
import styles from './workspace.module.css';

export default function FlowModal({open,title,onClose,children}:{open:boolean;title:string;onClose:()=>void;children:ReactNode}){
 const ref=useRef<HTMLDialogElement>(null),titleId=useId();
 useEffect(()=>{const dialog=ref.current;if(!dialog)return;if(open&&!dialog.open)dialog.showModal();else if(!open&&dialog.open)dialog.close();},[open]);
 return <dialog ref={ref} className={styles.modal+' '+styles.panel} aria-labelledby={titleId} onCancel={e=>{e.preventDefault();onClose();}}>
  <div className={styles.modalHeader}><h2 id={titleId}>{title}</h2><Button variant="secondary" className={styles.menuButton} onClick={onClose} aria-label={'Fechar '+title}>Fechar <span aria-hidden="true">×</span></Button></div>
  <div className={styles.modalBody}>{children}</div>
 </dialog>;
}

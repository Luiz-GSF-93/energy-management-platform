'use client';
import {useEffect,useRef,useState} from 'react';
import styles from './BotEnergyAvatar.module.css';

/** EVA's presentation changes independently of the licensed assistant identifiers. */
export default function BotEnergyAvatar({size=36}:{size?:number}){
 const ref=useRef<HTMLSpanElement>(null),[active,setActive]=useState(false);
 useEffect(()=>{
  const node=ref.current;if(!node)return;
  let visible=false;
  const sync=()=>setActive(visible&&document.visibilityState==='visible');
  const observer=new IntersectionObserver(entries=>{visible=entries.some(entry=>entry.isIntersecting);sync();});
  observer.observe(node);document.addEventListener('visibilitychange',sync);
  return()=>{observer.disconnect();document.removeEventListener('visibilitychange',sync);};
 },[]);
 return <span ref={ref} className={styles.avatar} data-active={active} aria-hidden="true" style={{width:size,height:size}}>
  <span className={styles.sphere}><img className={styles.image} src="/images/eva/eva-orb.webp" width={256} height={256} alt="" draggable={false}/></span>
  <span className={styles.orbit}><span className={styles.ribbon}/></span>
  <span className={`${styles.orbit} ${styles.second}`}><span className={styles.ribbon}/></span>
 </span>;
}

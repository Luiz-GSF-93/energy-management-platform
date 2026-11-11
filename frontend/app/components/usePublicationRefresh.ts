'use client';
import {useEffect,useRef,useState} from 'react';
const key='energyos-publication-updated';
/** The marker contains no organization, document, financial or credential data. */
export function notifyPublicationUpdated(){
 window.dispatchEvent(new Event('portal-updated'));
 try{window.localStorage.setItem(key,String(Date.now()));}catch{/* Polling remains available. */}
}
/** Re-read through each component's existing authenticated API; never cache private responses here. */
export function usePublicationRefresh({paused=false}:{paused?:boolean}={}){
 const [revision,setRevision]=useState(0);
 const pausedRef=useRef(paused),pending=useRef(false);pausedRef.current=paused;
 useEffect(()=>{if(!paused&&pending.current&&document.visibilityState!=='hidden'){pending.current=false;setRevision(n=>n+1);}},[paused]);
 useEffect(()=>{
  let last=0;
  const refresh=()=>{if(document.visibilityState==='hidden')return;if(pausedRef.current){pending.current=true;return;}if(Date.now()-last<1000)return;last=Date.now();pending.current=false;setRevision(n=>n+1);};
  const storage=(event:StorageEvent)=>{if(event.key===key)refresh();};
  const timer=setInterval(refresh,60000);
  window.addEventListener('portal-updated',refresh);window.addEventListener('focus',refresh);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);window.removeEventListener('portal-updated',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',refresh);};
 },[]);
 return revision;
}

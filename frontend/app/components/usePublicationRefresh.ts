'use client';
import {useEffect,useState} from 'react';
const key='energyos-publication-updated';
/** The marker contains no organization, document, financial or credential data. */
export function notifyPublicationUpdated(){
 window.dispatchEvent(new Event('portal-updated'));
 try{localStorage.setItem(key,String(Date.now()));}catch{/* Polling remains available. */}
}
/** Re-read through each component's existing authenticated API; never cache private responses here. */
export function usePublicationRefresh(){
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  let last=0;
  const refresh=()=>{if(document.visibilityState==='hidden'||Date.now()-last<1000)return;last=Date.now();setRevision(n=>n+1);};
  const storage=(event:StorageEvent)=>{if(event.key===key)refresh();};
  const timer=setInterval(refresh,60000);
  window.addEventListener('portal-updated',refresh);window.addEventListener('focus',refresh);window.addEventListener('storage',storage);document.addEventListener('visibilitychange',refresh);
  return()=>{clearInterval(timer);window.removeEventListener('portal-updated',refresh);window.removeEventListener('focus',refresh);window.removeEventListener('storage',storage);document.removeEventListener('visibilitychange',refresh);};
 },[]);
 return revision;
}

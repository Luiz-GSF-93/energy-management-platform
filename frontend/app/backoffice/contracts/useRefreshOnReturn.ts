'use client';
import {useEffect,useRef} from 'react';
/** Re-read a displayed diagnosis on return; never writes or polls in the background. */
export function useRefreshOnReturn(enabled:boolean,onRefresh:()=>void){
 const latest=useRef({enabled,onRefresh});
 useEffect(()=>{latest.current={enabled,onRefresh};},[enabled,onRefresh]);
 useEffect(()=>{
  let last=-Infinity;
  const refresh=()=>{if(document.visibilityState==='hidden'||!latest.current.enabled)return;const now=Date.now();if(now-last<1000)return;last=now;latest.current.onRefresh();};
  window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  return()=>{window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};
 },[]);
}

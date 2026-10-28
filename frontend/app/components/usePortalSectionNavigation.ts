'use client';
import {useEffect} from 'react';

/** Wait for licensed content to mount; stop aligning as soon as the user navigates. */
export function followPortalSection(id:string){
 let observer:MutationObserver|null=null,resize:ResizeObserver|null=null,frame=0,stopped=false;
 const stop=()=>{if(stopped)return;stopped=true;observer?.disconnect();resize?.disconnect();cancelAnimationFrame(frame);clearTimeout(timer);window.removeEventListener('wheel',stop);window.removeEventListener('touchstart',stop);window.removeEventListener('keydown',onKey);};
 const onKey=(e:KeyboardEvent)=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Escape','Tab'].includes(e.key))stop();};
 const align=()=>{if(stopped)return;const target=document.getElementById(id);if(!target)return;if(observer){observer.disconnect();observer=null;clearTimeout(timer);timer=setTimeout(stop,2000);}target.scrollIntoView?.({block:'start',behavior:'auto'});if(!resize&&typeof ResizeObserver!=='undefined'){resize=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(!stopped)target.scrollIntoView?.({block:'start',behavior:'auto'});});});resize.observe(document.querySelector('main')??document.body);}};
 let timer=setTimeout(stop,15000);
 window.addEventListener('wheel',stop,{passive:true});window.addEventListener('touchstart',stop,{passive:true});window.addEventListener('keydown',onKey);
 observer=new MutationObserver(align);observer.observe(document.body,{childList:true,subtree:true});align();return stop;
}
export default function usePortalSectionNavigation(enabled:boolean,ids:string,onSection:(id:string)=>void){
 useEffect(()=>{if(!enabled)return;let stop:(()=>void)|undefined;const follow=()=>{stop?.();const id=window.location.hash.slice(1);if(!ids.split(',').includes(id))return;onSection(id);stop=followPortalSection(id);};follow();window.addEventListener('hashchange',follow);window.addEventListener('popstate',follow);window.addEventListener('portal-section',follow);return()=>{stop?.();window.removeEventListener('hashchange',follow);window.removeEventListener('popstate',follow);window.removeEventListener('portal-section',follow);};},[enabled,ids,onSection]);
}

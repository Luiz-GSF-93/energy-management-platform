'use client';
import {useState, type ReactNode} from 'react';

/** Mount on first opening; retain drafts and request IDs when collapsed. */
export default function AdministrativeSection({title,children}:{title:string;children:ReactNode}){
 const [visited,setVisited]=useState(false);
 return <details style={{marginBlock:20}} onToggle={event=>{if(event.currentTarget.open)setVisited(true);}}>
  <summary style={{cursor:'pointer',fontWeight:600,paddingBlock:12}}>{title}</summary>
  {visited?<div style={{paddingBlock:12}}>{children}</div>:null}
 </details>;
}

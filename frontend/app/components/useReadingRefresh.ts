'use client';
import {useCallback,useEffect,useRef,useState} from 'react';

/** Only transport/temporary HTTP failures may retain an already authorized view. */
export function isTemporaryReadingFailure(error:unknown){
 const e=error as {status?:number;name?:string;message?:string}|null;
 if(typeof e?.status==='number')return e.status===408||e.status===429||e.status>=500&&e.status<=599;
 return e?.name==='TimeoutError'||e?.name==='TypeError'&&/^(Failed to fetch|NetworkError when attempting to fetch resource\.?|Load failed|fetch failed)$/i.test(e.message??'');
}
function sameReading<T>(a:T,b:T){
 // Query time is not a new publication. All scope, version and financial fields remain compared.
 const omitQueryTime=(key:string,value:unknown)=>key==='updatedAt'?undefined:value;
 return JSON.stringify(a,omitQueryTime)===JSON.stringify(b,omitQueryTime);
}
/** Pending private snapshots stay in memory and cannot be applied across scopes. */
export function useReadingRefresh<T>({defer,scope,data,apply}:{defer:boolean;scope:string;data:T|null;apply:(value:T)=>void}){
 const current=useRef(data),explicit=useRef(false),appliedScope=useRef(scope);current.current=data;
 const [pending,setPending]=useState<{scope:string;value:T}|null>(null);
 useEffect(()=>{setPending(null);explicit.current=false;},[scope]);
 const offer=useCallback((value:T)=>{
  if(!defer||current.current===null||appliedScope.current!==scope||explicit.current){appliedScope.current=scope;explicit.current=false;setPending(null);apply(value);return;}
  setPending(sameReading(current.current,value)?null:{scope,value});
 },[defer,scope,apply]);
 const accept=()=>{if(pending?.scope===scope){appliedScope.current=scope;apply(pending.value);setPending(null);}};
 const clear=()=>{setPending(null);explicit.current=false;};
 const expectRefresh=()=>{explicit.current=true;setPending(null);};
 const hasSnapshot=()=>current.current!==null&&appliedScope.current===scope;
 return{offer,accept,clear,expectRefresh,hasSnapshot,pending:pending?.scope===scope};
}

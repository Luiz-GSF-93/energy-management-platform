'use client';
import {useRef,useState} from 'react';
import CustomerSelector from '../backoffice/contracts/CustomerSelector';

/** Wrapping options with the existing native form value and validity contract. */
export default function OperationChoice({label,options,name,value,defaultValue='',onChange,onDirty,placeholder='Selecione',required=false,disabled=false,allowEmpty=true}:{
 label:string;options:{value:string;label:string}[];name?:string;value?:string;defaultValue?:string;onChange?:(value:string)=>void;onDirty?:()=>void;placeholder?:string;required?:boolean;disabled?:boolean;allowEmpty?:boolean;
}){
 const [local,setLocal]=useState(defaultValue),[invalid,setInvalid]=useState(false);const field=useRef<HTMLDivElement>(null);const selected=value??local;
 function choose(next:string){setLocal(next);setInvalid(false);onChange?.(next);onDirty?.();}
 return <div ref={field} data-operation-choice={label} style={{position:'relative',minWidth:0}}>
  <CustomerSelector label={label} customers={options.map(o=>({id:o.value,company_name:o.label}))} value={selected} onChange={choose} placeholder={placeholder} disabled={disabled} allowEmpty={allowEmpty} emptyMessage={`Nenhuma opção disponível em ${label}.`}/>
  <select aria-hidden="true" tabIndex={-1} name={name} value={selected} required={required} disabled={disabled} onChange={e=>choose(e.target.value)} onInvalid={e=>{e.preventDefault();setInvalid(true);field.current?.querySelector<HTMLElement>('summary')?.focus();}} style={{position:'absolute',width:1,height:1,padding:0,border:0,clipPath:'inset(50%)',overflow:'hidden',pointerEvents:'none'}}>
   <option value="" hidden={!allowEmpty}>{placeholder}</option>{options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
  </select>
  {invalid?<p role="alert">Selecione uma opção em {label}.</p>:null}
 </div>;
}

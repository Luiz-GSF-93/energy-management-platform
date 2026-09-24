'use client';
import {useRef,useState} from 'react';
import {Input} from './ui';
import {apiRequest} from '@/app/lib/api/client';
import {normalizeTaxId,validTaxId} from '@/app/lib/tax-id';
export default function CustomerIdentity({disabled}:{disabled:boolean}) {
 const [message,setMessage]=useState('');const seq=useRef(0),last=useRef('');
 async function lookup(input:HTMLInputElement){
  const value=normalizeTaxId(input.value);input.value=value;
  if(!validTaxId(value)){input.setCustomValidity('CPF ou CNPJ inválido. Confira o número.');setMessage(input.validationMessage);return;}
  input.setCustomValidity('');if(value.length!==14){setMessage('CPF com dígitos válidos.');return;}
  if(last.current===value)return;last.current=value;
  const request=++seq.current,form=input.form!;
  const company=form.elements.namedItem('company_name') as HTMLInputElement,trade=form.elements.namedItem('trade_name') as HTMLInputElement;
  const before=[company.value,trade.value];setMessage('Consultando CNPJ…');
  try{const data=await apiRequest<{company_name:string;trade_name:string;registration_status:string;source:string}>('/api/v1/customers/cnpj/'+value);
   if(request!==seq.current||normalizeTaxId(input.value)!==value)return;
   if(company.value===before[0]&&!company.value)company.value=data.company_name;
   if(trade.value===before[1]&&!trade.value)trade.value=data.trade_name;
   setMessage('Consulta: '+data.company_name+' — situação cadastral: '+data.registration_status+'. Fonte: '+data.source+'. Confira os dados antes de salvar. Campos já preenchidos foram preservados.');
  }catch(e){if(request===seq.current){last.current='';setMessage(e instanceof Error?e.message:'Consulta indisponível. Preencha manualmente.');}}
 }
 return <><Input label="CPF / CNPJ" name="document" required maxLength={18} disabled={disabled} onChange={e=>{seq.current++;last.current='';e.target.setCustomValidity('');setMessage('');}} onBlur={e=>{if(e.target.value)void lookup(e.target);}}/><p>CNPJ: consulta automática ao sair do campo. Somente o CNPJ é enviado à Minha Receita. A validação dos dígitos não comprova situação cadastral ativa.</p>{message?<p role="status">{message}</p>:null}<Input label="Razão social" name="company_name" required disabled={disabled}/><Input label="Nome fantasia" name="trade_name" disabled={disabled}/></>;
}

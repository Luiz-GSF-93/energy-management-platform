'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card,Button} from '@/app/components/ui';
import type {CorrectionContext} from './preparation-navigation';
type Cycle={month:string;rows:{consumerUnitId:string;name:string;needsVolume:boolean}[]};
export default function SupplierCycle({customerId,onCorrect}:{customerId:string;onCorrect?:(c:CorrectionContext)=>void}){
 const [data,setData]=useState<Cycle|null>(null),[error,setError]=useState('');
 useEffect(()=>{let cancelled=false;apiRequest<Cycle>('/api/v1/supplier-billing-rules/cycle?customerId='+encodeURIComponent(customerId)).then(r=>{if(!cancelled)setData(r);}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[customerId]);
 return <Card title='Último ciclo mensal encerrado'>{error?<Alert variant='error'>{error}</Alert>:!data?<p>Conferindo volume mensal...</p>:<><p>Competência {data.month.slice(5)+'/'+data.month.slice(0,4)}. Verificação automática ao abrir esta área. O cálculo exige volume validado e condições contratuais vigentes.</p>{data.rows.length?data.rows.map(r=><div className='ds-card' key={r.consumerUnitId}><strong>{r.name}</strong><p>{r.needsVolume?'Registre ou corrija e valide o volume desta competência.':'Volume validado disponível. Confira o faturamento contratual e os demais requisitos.'}</p>{onCorrect?<Button variant='secondary' onClick={()=>onCorrect({customerId,unitId:r.consumerUnitId,month:data.month,tab:r.needsVolume?'monthly':'preparation',message:'Conferência do último ciclo encerrado.'})}>{r.needsVolume?'Registrar volume mensal':'Conferir faturamento'}</Button>:null}</div>):<p>Não há unidade ACL com contrato ativo/aprovado nesse período.</p>}</>}</Card>;
}

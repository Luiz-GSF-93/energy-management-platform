'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card} from '@/app/components/ui';
export default function CceeMetrics({month}:{month:string}){
 const[data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);setError('');void apiRequest<any>('/api/v1/admin/platform-costs/ccee?'+new URLSearchParams({month})).then(v=>{if(live&&v.month===month)setData(v);}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[month]);
 return <Card title="CCEE · leituras e processamento">{error&&<Alert>{error}</Alert>}{data&&<><p>{data.jobs} solicitações · {data.completed} completas · {data.partial} com cobertura parcial · {data.failed} falhas.</p><p>{data.requests} tentativas de requisição registradas · {data.bytes} bytes recebidos medidos · {data.durationMs} ms de processamento registrado. Leituras interrompidas sem finalização podem ter métricas incompletas.</p><p>Custo efetivo da integração: não apurado. Rede, banco e processamento devem ser vinculados aos lançamentos existentes no catálogo; não somar novamente custos compartilhados.</p><p>Use o modelo “CCEE · integração, processamento e tráfego” no catálogo de serviços. O orçamento precisa ser definido pelo Owner; avisos de 80% seguem o orçamento e os gastos registrados no catálogo. Não há consulta de faturamento CCEE nem orçamento presumido.</p></>}</Card>;
}

'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card} from '@/app/components/ui';
export default function EvaSearchExecutionMetrics({month}:{month:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);void apiRequest<any>('/api/v1/admin/eva/search-executions/metrics?'+new URLSearchParams({month})).then(x=>{if(live){setData(x);setError('')}}).catch(e=>{if(live)setError(e.message??'Métricas indisponíveis.')});return()=>{live=false}},[month]);
 return <Card title="EVA · execução privada de indexação">{error&&<Alert>{error}</Alert>}{data&&<><p>{data.commands} comandos · {data.confirmed} conferidos · {data.unknown} com resultado desconhecido.</p><p>{data.requests} tentativas de chamadas reservadas · {data.inputTokens} tokens com recibo confirmado. Falhas podem ter consumo adicional não confirmado.</p><p>Tempo médio de execução registrada: {data.averageWorkerMs==null?'não informado':`${data.averageWorkerMs} ms`}. Não representa latência de resposta do chat.</p><p>Custo monetário não apurado; faturamento e tarifas não conectados. Consulte o catálogo para estimativas e orçamento de cada serviço. Search, embeddings e tráfego são componentes separados.</p></>}</Card>;
}

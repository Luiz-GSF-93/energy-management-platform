'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card} from '@/app/components/ui';
export default function EvaCorpusMetrics({month}:{month:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);void apiRequest<any>('/api/v1/admin/eva/corpus-publications/metrics?'+new URLSearchParams({month})).then(x=>{if(live){setData(x);setError('')}}).catch(e=>{if(live)setError(e.message??'Métricas indisponíveis.')});return()=>{live=false}},[month]);
 const money=(v:number|null)=>v===null?'não apurado':'USD '+(v/1000000).toFixed(6);
 return <Card title="EVA · publicação e consulta do corpus">{error&&<Alert>{error}</Alert>}{data&&<><p>{data.active} publicações ativas · {data.requests} consultas iniciadas · {data.completed} concluídas · {data.ready} com evidências · {data.failed} falhas.</p><p>Latência de recuperação p50: {data.p50RetrievalMs??'não informada'} ms · p95: {data.p95RetrievalMs??'não informada'} ms. Não inclui geração da resposta.</p><p>{data.inputTokens} tokens de consulta · {data.searchRequests} requisições Search. Embeddings: {money(data.embeddingCostMicroUsd)}.</p><p>Este consumo já integra o histórico de IA. Não somar novamente. Geração de respostas é acompanhada no histórico de IA; custo fixo Search, Blob e orçamentos ficam no catálogo de serviços. Faturamento dos provedores não conectado.</p></>}</Card>;
}

'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card} from '@/app/components/ui';
export default function EvaCompositeMetrics({month}:{month:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);void apiRequest<any>('/api/v1/admin/eva/composite-releases/metrics?'+new URLSearchParams({month})).then(x=>{if(live){setData(x);setError('')}}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[month]);
 return <Card title="EVA · documentos longos e publicação composta">{error&&<Alert>{error}</Alert>}{data&&<><p>{data.releases} preparações na competência · {data.embeddingTokens} tokens de indexação registrados · {data.providerRequests} solicitações externas reservadas · {data.unknownBatches} lotes com resultado incerto.</p><p>Consultas: {data.queryRequests} iniciadas · {data.queryCompleted} concluídas · {data.queryTokens} tokens · {data.querySearchRequests} requisições Search.</p><p>Valor faturado não apurado. Tokens e reservas são evidências operacionais; uma reserva não comprova execução no provedor. Embeddings de consulta já integram o histórico de IA, sem somar novamente. Search e Blob permanecem no catálogo de serviços, com seus orçamentos e alertas.</p></>}</Card>;
}

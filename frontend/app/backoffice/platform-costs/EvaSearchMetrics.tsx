'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
import {Alert,Card} from '@/app/components/ui';
export default function EvaSearchMetrics({month}:{month:string}){
 const [data,setData]=useState<any>(null),[error,setError]=useState('');
 useEffect(()=>{let live=true;setData(null);void apiRequest<any>('/api/v1/admin/eva/search-releases/metrics?'+new URLSearchParams({month})).then(x=>{if(live){setData(x);setError('')}}).catch(e=>{if(live)setError(e.message??'Métricas indisponíveis.')});return()=>{live=false}},[month]);
 return <Card title="EVA · preparação de Azure AI Search">{error&&<Alert>{error}</Alert>}{data&&<><p>{data.preparedReleases} releases · {data.preparedChunks} fragmentos · {data.externalRequests} chamadas externas.</p><p>Serviços: Azure AI Search, embeddings e Azure OpenAI. Custo: não apurado; faturamento não conectado. O orçamento Blob não cobre estes serviços.</p><p>{data.costBasis}</p></>}</Card>;
}

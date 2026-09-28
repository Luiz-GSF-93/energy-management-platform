'use client';
import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api/client';
type Preview={token:string;state:string;canCreate:boolean;message:string;targetVersion:number;inputId:string|null;parameterIds:string[]};
export default function OcrSplitDemandIntegration({documentId}:{documentId:string}){
 const [data,setData]=useState<Preview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const url='/documents/'+encodeURIComponent(documentId)+'/ocr/split-demand-integration';
 const refresh=async()=>{setBusy(true);setError('');try{setData(await apiRequest<Preview>(url));}catch{setError('Não foi possível consultar a integração das parcelas. Atualize a situação.');}finally{setBusy(false);}};
 useEffect(()=>{let active=true;setData(null);setError('');setMessage('');apiRequest<Preview>(url).then(v=>{if(active)setData(v);}).catch(()=>{if(active)setError('Não foi possível consultar a integração das parcelas. Atualize a situação.');});return()=>{active=false;};},[url]);
 const integrate=async()=>{if(!data?.canCreate||busy)return;setBusy(true);setError('');try{await apiRequest(url,{method:'POST',body:{token:data.token}});setMessage('Integração salva: parcelas mensais e duas tarifas em rascunho. Histórico e versão anterior preservados.');setData(await apiRequest<Preview>(url));}catch{setError('A integração não foi confirmada. Atualize a situação antes de tentar novamente; o sistema evita duplicidade.');}finally{setBusy(false);}};
 return <section aria-label='Integração das parcelas OCR'><h4>Integrar parcelas e tarifas da fatura</h4><p>{data?.message??'Consultando integração…'}</p>{data&&<p>Versão mensal de destino: {data.targetVersion}. Os registros ficam sujeitos à validação e aprovação.</p>}{error&&<p role='alert'>{error}</p>}{message&&<p role='status'>{message}</p>}<button type='button' disabled={busy} onClick={refresh}>Atualizar integração das parcelas</button>{data?.canCreate&&<button type='button' disabled={busy} onClick={integrate}>{busy?'Integrando…':'Integrar parcelas e tarifas automaticamente'}</button>}{data?.state==='INTEGRATED'&&<p>Integração registrada · {data.parameterIds.length} tarifas. Consulte Dados mensais e Parâmetros de cálculo, depois atualize Preparar apuração.</p>}</section>;
}

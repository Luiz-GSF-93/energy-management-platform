'use client';

import {useEffect,useState} from 'react';
import {apiRequest} from '@/app/lib/api';
import {Alert} from '@/app/components/ui';
import ReportPresentation,{PublishedReport} from './ReportPresentation';
import {publishedConsumptionRows,ConsumptionReport,ConsumptionResponse} from './published-consumption';
import type {PublishedConsumption} from './ConsumptionViews';

export default function PublishedReportPresentation({report,organizationId,view}:{report:ConsumptionReport&{body:PublishedReport};organizationId:string;view:'OPERATIONAL'|'EXECUTIVE'|'FINANCIAL'}){
 const key=organizationId+'|'+report.id;
 const [reading,setReading]=useState<{key:string;rows:PublishedConsumption[]}|null>(null);
 useEffect(()=>{
  if(report.body.header.organizationId!==organizationId)return;
  let live=true;const controller=new AbortController();
  const query=new URLSearchParams({from:report.body.period.from,to:report.body.period.to,customerId:report.body.header.customerId,unitId:report.body.header.unitId});
  apiRequest<ConsumptionResponse>('/api/v1/financial-settlements/reports?'+query,{signal:controller.signal}).then(response=>{
   const rows=publishedConsumptionRows(report,response);if(live)setReading({key,rows});
  }).catch(()=>{if(live)setReading({key,rows:report.body.invoices.map(i=>({...i,peakKwh:null,offPeakKwh:null,bandMessage:'Consulta das medições indisponível. As informações originais do relatório foram preservadas.'}))});});
  return()=>{live=false;controller.abort();};
 },[report,organizationId,key]);
 if(report.body.header.organizationId!==organizationId)return <Alert variant="error">Relatório indisponível na organização ativa.</Alert>;
 const invoices=reading?.key===key?reading.rows:report.body.invoices.map(i=>({...i,peakKwh:null,offPeakKwh:null,bandMessage:'Consultando a medição publicada correspondente…'}));
 return <ReportPresentation body={report.body} view={view} consumptionInvoices={invoices}/>;
}

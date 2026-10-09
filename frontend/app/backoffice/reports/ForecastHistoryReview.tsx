'use client';
import {Button} from '@/app/components/ui';
import {useOriginalInvoice} from '../documents/OcrOriginalInvoice';
export default function ForecastHistoryReview({documentId}:{documentId:string}){
 const original=useOriginalInvoice(documentId);
 return <><Button variant="secondary" onClick={()=>void original.open?.()}>Conferir PDF da fonte</Button>{original.viewer}</>;
}

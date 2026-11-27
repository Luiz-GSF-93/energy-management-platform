'use client';
import {Button} from './ui';
/** Always mounted: new data never inserts a banner above the content being read. */
export default function ReadingRefreshControl({pending,onApply,error=''}:{pending:boolean;onApply:()=>void;error?:string}){
 const status=error?'Atualização indisponível; última consulta preservada.':pending?'Novas informações disponíveis; sua leitura foi preservada.':'Sua consulta permanece estável durante a leitura.';
 return <div><Button variant="secondary" disabled={!pending} onClick={onApply} title={pending?'Novas informações disponíveis; aplique quando terminar sua leitura.':'Sua visualização será preservada quando chegarem novas informações.'}>Aplicar informações atualizadas</Button><p role="status" title={error||status} style={{height:'1.5em',margin:'8px 0',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{status}</p></div>;
}

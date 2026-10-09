'use client';

import {useId,useState} from 'react';
import {Card} from '@/app/components/ui';
import styles from './report-workspace.module.css';

export type PublishedConsumption={month:string;consumptionKwh:string|null;reservationCount:number;version?:number;payloadHash?:string;peakKwh?:string|null;offPeakKwh?:string|null;measurementSource?:string;measurementVersion?:number;measurementRevision?:number;bandMessage?:string};
const shown=(value:string)=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:6});

export default function ConsumptionViews({invoices}:{invoices:PublishedConsumption[]}){
 const [source,setSource]=useState<'DISTRIBUTOR'|'CCEE'>('DISTRIBUTOR');
 const panelId=useId();
 const maximum=Math.max(0,...invoices.map(i=>i.consumptionKwh===null?0:Number(i.consumptionKwh)));
 const available=invoices.some(i=>i.consumptionKwh!==null);
 const bandMaximum=Math.max(0,...invoices.flatMap(i=>[Number(i.peakKwh??0),Number(i.offPeakKwh??0)]));
 const bandsAvailable=invoices.some(i=>i.peakKwh!=null||i.offPeakKwh!=null);
 return <Card title="Consumo mensal validado · fontes de medição">
  <div id={panelId} role="region" aria-label={source==='DISTRIBUTOR'?'Consumo da fatura da distribuidora':'Consumo medido CCEE'}>
   {source==='DISTRIBUTOR'?<>
    <p>Leituras preservadas na versão publicada. Esta série é de faturas e não representa uma consulta de consumo à API CCEE.</p>
    {available?<><div className={styles.bars} aria-hidden="true">{invoices.map((i,index)=><div className={styles.barColumn} key={`${i.month}-${index}`}><span>{i.consumptionKwh===null?'Sem leitura':shown(i.consumptionKwh)}</span><div className={styles.barTrack}>{i.consumptionKwh!==null?<div className={styles.bar} style={{height:`${maximum>0?Number(i.consumptionKwh)/maximum*100:0}%`}}/>:null}</div><small>{i.month}</small></div>)}</div><table className={styles.table}><caption>Consumo total da fatura publicada, em kWh</caption><thead><tr><th>Competência</th><th>Consumo total (kWh)</th><th>Ressalvas</th></tr></thead><tbody>{invoices.map((i,index)=><tr key={`${i.month}-${index}`}><td>{i.month}</td><td>{i.consumptionKwh===null?'Indisponível':shown(i.consumptionKwh)}</td><td>{i.reservationCount}</td></tr>)}</tbody></table></>:<p>Nenhuma leitura de consumo disponível nesta versão.</p>}
    <h3>Consumo ponta e fora ponta · distribuidora</h3>
    {bandsAvailable?<><div className={styles.bars} aria-hidden="true">{invoices.map((i,index)=><div className={`${styles.barColumn} ${styles.bandColumn}`} key={`${i.month}-${index}`}><div className={styles.bandPair}>{[['Ponta',i.peakKwh,styles.peakBar],['Fora ponta',i.offPeakKwh,styles.offPeakBar]].map(([label,value,color])=><div key={label}><span>{value==null?'Indisponível':shown(value)}</span><div className={styles.barTrack}>{value!=null?<div className={`${styles.bar} ${color}`} style={{height:`${bandMaximum>0?Number(value)/bandMaximum*100:0}%`}}/>:null}</div><small>{label}</small></div>)}</div><small>{i.month}</small></div>)}</div><p><span className={`${styles.swatch} ${styles.peakBar}`}/>Ponta · <span className={`${styles.swatch} ${styles.offPeakBar}`}/>Fora ponta — kWh, mesma escala.</p></>:<div className={styles.missingSeries}><p>Postos horários indisponíveis nesta consulta. O total não foi dividido ou usado para estimar ponta e fora ponta.</p></div>}
    <table className={styles.table}><caption>Postos horários da leitura validada, em kWh</caption><thead><tr><th>Competência</th><th>Ponta (kWh)</th><th>Fora ponta (kWh)</th><th>Conferência da fonte</th></tr></thead><tbody>{invoices.map((i,index)=><tr key={`${i.month}-${index}`}><td>{i.month}</td><td>{i.peakKwh==null?'Indisponível':shown(i.peakKwh)}</td><td>{i.offPeakKwh==null?'Indisponível':shown(i.offPeakKwh)}</td><td>{i.bandMessage??'Postos não incluídos na versão original; aguardando leitura publicada correspondente.'}</td></tr>)}</tbody></table>
   </>:<>
    <div className={styles.missingSeries}><strong>Consumo medido CCEE · ponta e fora ponta</strong><p>Indisponível nesta versão. A integração CCEE independente deverá fornecer as medições autorizadas e validadas. Valores da fatura e PLD não substituem consumo medido CCEE.</p></div>
   </>}
  </div>
  <footer className={styles.sourceFooter}>
   <span>Fonte da visualização</span>
   <div role="group" aria-label="Visão do consumo"><button type="button" className={styles.sourceButton} aria-pressed={source==='DISTRIBUTOR'} aria-controls={panelId} onClick={()=>setSource('DISTRIBUTOR')}>Visão distribuidora</button><button type="button" className={styles.sourceButton} aria-pressed={source==='CCEE'} aria-controls={panelId} onClick={()=>setSource('CCEE')}>Visão CCEE</button></div>
  </footer>
  <details className={styles.auditDetails}><summary>Conferir fontes · fatura distribuidora × CCEE</summary>
   <p>Comparação por competência da mesma unidade. Não há percentual calculado nesta tela: o resultado depende da conciliação no motor, com períodos e tratamento de perdas compatíveis.</p>
   <table className={styles.table}><caption>Disponibilidade das fontes e da conciliação publicada</caption><thead><tr><th>Competência</th><th>Fatura (kWh)</th><th>CCEE (kWh)</th><th>Diferença (%)</th><th>Situação</th></tr></thead><tbody>{invoices.map((i,index)=><tr key={`${i.month}-${index}`}><td>{i.month}</td><td>{i.consumptionKwh===null?'Indisponível':shown(i.consumptionKwh)}</td><td>Indisponível nesta versão</td><td>Indisponível</td><td>Aguardando fonte CCEE e conciliação</td></tr>)}</tbody></table>
   <ul>{invoices.map((i,index)=><li key={`${i.month}-${index}`}><strong>{i.month} · Fatura publicada</strong> · Versão {i.version??'não informada'}<br/>Hash da publicação: <code>{i.payloadHash??'Não informado nesta versão'}</code>{i.measurementSource?<><br/>Fonte da medição: {i.measurementSource} · Versão {i.measurementVersion} · Revisão {i.measurementRevision}</>:null}</li>)}</ul>
   <p>Fonte CCEE: identificador, revisão e hash ainda indisponíveis neste relatório. Ausência de dados não significa diferença zero nem conformidade comprovada.</p>
  </details>
 </Card>;
}
